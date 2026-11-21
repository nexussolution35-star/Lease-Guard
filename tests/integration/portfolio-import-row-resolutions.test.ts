import { unwrap, type ApiClient } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, serviceRole, world } from './support/clients.ts'

/**
 * Resolving the rows of a portfolio import (ticket I-03) through the real API and the local database: a manager
 * corrects a value, skips a row and links a row to an existing property; each change is checked again at once, kept on
 * the batch row (never on a property or unit), signed off with who made it, audited with the previous and new value,
 * and the batch can be found again in the import history.
 */

const CSV = Buffer.from(
  [
    'Prop Code,Unit No,Unit Type,Unit Size,Status',
    'ACP,ACP-001,Line shop,120,Occupied',
    'ACP,ACP-RES1,Line shp,40,Vacant',
    'ACP,ACP-001,Line shop,120,Occupied',
    'ZZR,ZR-1,Line shop,10,Vacant',
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

const changeRow = (client: ApiClient, importId: string, rowNumber: number, body: Record<string, unknown>) =>
  client.PATCH('/api/v1/portfolio-imports/{importId}/rows/{rowNumber}', { params: { path: { importId, rowNumber } }, body })

describe('portfolio imports: resolve row exceptions', () => {
  it('corrects, skips and links rows on the batch only, checks them again, signs them off and audits each change', async () => {
    const manager = apiAs('manager', 'a')
    const managerId = world().users.manager.id
    const companyId = world().companies.a.id
    const acp = world().companies.a.properties.find((property) => property.code === 'ACP')!
    const unitsBefore = check(await serviceRole().from('units').select('id, unit_number, type').eq('company_id', companyId).order('id'), 'List units')
    const batch = await upload(manager, 'resolve.csv', CSV)

    // The suggested mapping reads every column; row 3 has a misspelt unit type, row 4 repeats row 2.
    const before = await unwrap(manager.GET('/api/v1/portfolio-imports/{importId}/preview', { params: { path: { importId: batch.id }, query: { pageSize: 100 } } }))
    expect(before.items.map((row) => [row.rowNumber, row.result])).toEqual([
      [2, 'match'],
      [3, 'invalid'],
      [4, 'duplicate'],
      [5, 'invalid'],
    ])

    // A correction is checked again at once and signed off with who made it.
    const corrected = await unwrap(changeRow(manager, batch.id, 3, { corrections: { unitType: 'Line shop' } }))
    expect(corrected).toMatchObject({
      rowNumber: 3,
      result: 'new',
      values: { unitType: 'Line shop' },
      resolution: { corrections: [{ field: 'unitType', value: 'Line shop', fileValue: 'Line shp' }], skipped: false, changedByUserId: managerId },
    })

    // Skipping row 2 leaves row 4 the only row naming ACP-001: it is no longer a duplicate.
    expect(await unwrap(changeRow(manager, batch.id, 2, { skipped: true }))).toMatchObject({ result: 'skipped' })

    // Row 5 names a property LeaseGuard does not have; linked to ACP it adds its unit there instead.
    const linked = await unwrap(changeRow(manager, batch.id, 5, { link: { propertyId: acp.id } }))
    expect(linked).toMatchObject({ result: 'new', property: { id: acp.id }, resolution: { linkedProperty: { id: acp.id, label: acp.name } } })

    const after = await unwrap(manager.GET('/api/v1/portfolio-imports/{importId}/preview', { params: { path: { importId: batch.id }, query: { pageSize: 100 } } }))
    expect(after.items.map((row) => [row.rowNumber, row.result])).toEqual([
      [2, 'skipped'],
      [3, 'new'],
      [4, 'match'],
      [5, 'new'],
    ])
    expect(after.counts).toEqual({ new: 2, match: 1, suggested: 0, conflict: 0, invalid: 0, duplicate: 0, skipped: 1 })

    // Every change is audited on the batch with the signed-in user, the previous and the new value.
    const audit = check(
      await serviceRole()
        .from('audit_logs')
        .select('actor_user_id, summary, changes')
        .eq('entity_id', batch.id)
        .like('summary', 'Row %')
        .order('occurred_at'),
      'Read audit',
    )
    expect(audit.map((entry) => entry.summary)).toEqual([
      'Row 3 of portfolio file resolve.csv: unitType corrected',
      'Row 2 of portfolio file resolve.csv: skipped',
      `Row 5 of portfolio file resolve.csv: linked to ${acp.name}`,
    ])
    expect(audit.every((entry) => entry.actor_user_id === managerId)).toBe(true)
    expect(audit[0]!.changes).toEqual([{ field: 'row 3 unitType', before: 'Line shp', after: 'Line shop' }])
    expect(audit[2]!.changes).toEqual([{ field: 'row 5 linkedPropertyId', before: null, after: acp.id }])

    // The batch is in the import history, to be resumed later.
    const history = await unwrap(manager.GET('/api/v1/portfolio-imports', { params: { query: { scope: 'properties', pageSize: 100 } } }))
    expect(history.items.map((item) => item.id)).toContain(batch.id)

    // Nothing was written to units or properties.
    expect(check(await serviceRole().from('units').select('id, unit_number, type').eq('company_id', companyId).order('id'), 'List units')).toEqual(unitsBefore)
    expect(check(await serviceRole().from('properties').select('id').eq('company_id', companyId).eq('code', 'ZZR'), 'Look for ZZR')).toEqual([])
  })

  it('refuses members who only read (403), another company (404) and a field a units import does not read (422)', async () => {
    const manager = apiAs('manager', 'a')
    const batch = await upload(manager, 'refuse.csv', Buffer.from('Prop Code,Unit No\r\nACP,X1\r\n', 'utf8'))

    const readOnly = await apiErrorOf(unwrap(changeRow(apiAs('readOnly', 'a'), batch.id, 2, { skipped: true })))
    expect(readOnly.status).toBe(403)
    const owner = await apiErrorOf(unwrap(changeRow(apiAs('owner', 'a'), batch.id, 2, { skipped: true })))
    expect(owner.status).toBe(403)
    const other = await apiErrorOf(unwrap(changeRow(apiAs('manager', 'b'), batch.id, 2, { skipped: true })))
    expect(other.status).toBe(404)
    const missingRow = await apiErrorOf(unwrap(changeRow(manager, batch.id, 99, { skipped: true })))
    expect(missingRow.status).toBe(404)

    const row = check(await serviceRole().from('portfolio_import_rows').select('skipped, changed_at').eq('import_id', batch.id), 'Read row')
    expect(row).toEqual([{ skipped: false, changed_at: null }])
  })
})
