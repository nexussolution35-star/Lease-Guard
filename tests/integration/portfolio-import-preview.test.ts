import { unwrap, type ApiClient } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, serviceRole, world } from './support/clients.ts'
import { auditCount } from './support/local-db.ts'

/**
 * Mapping a portfolio file's columns and previewing its rows (ticket I-02) through the real API and the local
 * database: the mapping is suggested from the headings, applied by a manager and reused for the next file with the
 * same headings; every row is checked against the company's properties and units (match, new, conflict, invalid,
 * duplicate) and nothing is written to properties or units.
 */

const HEADINGS = 'Prop Code,Unit No,Shop Category,Unit Size,Status,Remarks'
const CSV = Buffer.from(
  [
    HEADINGS,
    'ACP,ACP-001,Line shop,120,Occupied,',
    'ACP,ACP-001,Line shop,120,Occupied,again',
    'ACP,ACP-002,Kiosk,120,Occupied,',
    'ACP,ACP-NEW9,Line shop,"50,5",Vacant,',
    'ZQP,Q1,Line shop,10,Vacant,',
    '',
  ].join('\r\n'),
  'utf8',
)

async function upload(client: ApiClient, fileName: string, file: Buffer) {
  const target = await unwrap(client.POST('/api/v1/portfolio-imports/upload-url', { body: { fileName, sizeBytes: file.length } }))
  const put = await fetch(target.signedUrl, { method: 'PUT', headers: { 'content-type': target.contentType }, body: new Uint8Array(file) })
  expect(put.ok, `storage answered ${put.status}`).toBe(true)
  return unwrap(client.POST('/api/v1/portfolio-imports', { body: { scope: 'properties', storagePath: target.storagePath, fileName, sizeBytes: file.length } }))
}

const preview = (client: ApiClient, importId: string, result?: 'new' | 'match' | 'conflict' | 'invalid' | 'duplicate') =>
  unwrap(client.GET('/api/v1/portfolio-imports/{importId}/preview', { params: { path: { importId }, query: { pageSize: 100, ...(result ? { result } : {}) } } }))

describe('portfolio imports: map columns and preview', () => {
  it('suggests, applies and reuses a mapping, and checks every row against the database without writing to it', async () => {
    const manager = apiAs('manager', 'a')
    const companyId = world().companies.a.id
    const unitsBefore = check(await serviceRole().from('units').select('id').eq('company_id', companyId), 'Count units').length
    const batch = await upload(manager, 'rent-roll.csv', CSV)

    // Suggested from the headings: "Shop Category" is not a known heading, so the unit type is not read yet.
    const suggested = await unwrap(manager.GET('/api/v1/portfolio-imports/{importId}/mapping', { params: { path: { importId: batch.id } } }))
    expect(suggested.source).toBe('suggested')
    const columnOf = (mapping: typeof suggested, field: string) => mapping.fields.find((f) => f.field === field)?.column
    expect([columnOf(suggested, 'propertyCode'), columnOf(suggested, 'unitNumber'), columnOf(suggested, 'floorAreaSqm'), columnOf(suggested, 'occupancyStatus')]).toEqual([
      'Prop Code',
      'Unit No',
      'Unit Size',
      'Status',
    ])
    expect(columnOf(suggested, 'unitType')).toBeUndefined()

    const before = await preview(manager, batch.id)
    expect(before.items.map((row) => [row.rowNumber, row.result])).toEqual([
      [2, 'match'],
      [3, 'duplicate'],
      [4, 'match'],
      [5, 'invalid'],
      [6, 'invalid'],
    ])
    expect(before.items[3]!.reasons).toEqual(['Unit type is missing'])

    // The manager reads the unit type from "Shop Category".
    const mapping = {
      propertyCode: 'Prop Code',
      unitNumber: 'Unit No',
      unitType: 'Shop Category',
      floorAreaSqm: 'Unit Size',
      occupancyStatus: 'Status',
    }
    const applied = await unwrap(manager.PUT('/api/v1/portfolio-imports/{importId}/mapping', { params: { path: { importId: batch.id } }, body: { mapping } }))
    expect(applied.source).toBe('applied')
    expect(await auditCount(batch.id)).toBe(2)

    const after = await preview(manager, batch.id)
    expect(after.counts).toEqual({ new: 1, match: 1, suggested: 0, conflict: 1, invalid: 1, duplicate: 1, skipped: 0 })
    const byRow = new Map(after.items.map((row) => [row.rowNumber, row]))
    expect(byRow.get(2)).toMatchObject({ result: 'match', unit: { label: 'ACP-001' } })
    expect(byRow.get(3)).toMatchObject({ result: 'duplicate', duplicateOfRowNumber: 2 })
    expect(byRow.get(4)).toMatchObject({ result: 'conflict', conflicts: [{ field: 'unitType', value: 'kiosk', existingValue: 'line_shop' }] })
    expect(byRow.get(5)).toMatchObject({ result: 'new', reasons: ['Adds the unit ACP-NEW9 to Acacia Park Shopping Centre'] })
    expect(byRow.get(6)!.result).toBe('invalid')
    expect(byRow.get(6)!.reasons).toContain('Property name is missing')

    const conflicts = await preview(manager, batch.id, 'conflict')
    expect(conflicts.items.map((row) => row.rowNumber)).toEqual([4])

    // The next file with the same headings starts from the applied mapping.
    const next = await upload(manager, 'rent-roll (December).csv', CSV)
    const reused = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/portfolio-imports/{importId}/mapping', { params: { path: { importId: next.id } } }))
    expect(reused.source).toBe('saved')
    expect(columnOf(reused, 'unitType')).toBe('Shop Category')

    // Nothing was written to properties or units.
    expect(check(await serviceRole().from('units').select('id').eq('company_id', companyId), 'Count units')).toHaveLength(unitsBefore)
    expect(check(await serviceRole().from('properties').select('id').eq('company_id', companyId).eq('code', 'ZQP'), 'Look for ZQP')).toEqual([])
  })

  it('refuses a mapping with a column the file lacks (422), members who only read (403) and another company (404)', async () => {
    const manager = apiAs('manager', 'a')
    const batch = await upload(manager, 'small.csv', Buffer.from('Unit No,Unit Size\r\nX1,10\r\n', 'utf8'))
    const path = { params: { path: { importId: batch.id } } }

    const missing = await apiErrorOf(unwrap(manager.PUT('/api/v1/portfolio-imports/{importId}/mapping', { ...path, body: { mapping: { unitNumber: 'Unit' } } })))
    expect(missing.status).toBe(422)
    expect(missing.messages).toEqual(['The file has no column "Unit"'])

    const readOnly = await apiErrorOf(unwrap(apiAs('readOnly', 'a').PUT('/api/v1/portfolio-imports/{importId}/mapping', { ...path, body: { mapping: {} } })))
    expect(readOnly.status).toBe(403)

    const other = await apiErrorOf(unwrap(apiAs('manager', 'b').GET('/api/v1/portfolio-imports/{importId}/preview', path)))
    expect(other.status).toBe(404)
  })
})
