import { unwrap, type ApiClient } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * Approving a portfolio import (ticket I-04) through the real API and the local database: the summary counts what
 * approving creates; the approval creates two properties and four units in one transaction through the property and
 * unit write paths, signs the approval off, lists every created record and audits each as created by import with the
 * batch reference; a blocked row stays out until it is fixed; approving twice or importing the same file again creates
 * nothing; members who only read cannot approve; and no tenant message is created.
 */

const HEADER = 'Property code,Property name,Property type,Address line 1,Suburb,City,Province,Postal code,Gross lettable area (m²),Unit number,Unit type,Floor area (m²),Unit status'
const ROWS = [
  'IPA,Import Park,Office,5 Bath Avenue,Rosebank,Johannesburg,Gauteng,2196,4000,A1,Office suite,150,Vacant',
  'IPA,Import Park,Office,5 Bath Avenue,Rosebank,Johannesburg,Gauteng,2196,4000,A2,Office suite,90,Occupied',
  'IPB,Import Centre,Shopping centre,9 Long Street,Cape Town City Centre,Cape Town,Western Cape,8001,9000,S1,Line shop,80,Vacant',
  'IPB,Import Centre,Shopping centre,9 Long Street,Cape Town City Centre,Cape Town,Western Cape,8001,9000,S2,Kiosk,12,Vacant',
  'IPB,Import Centre,Shopping centre,9 Long Street,Cape Town City Centre,Cape Town,Western Cape,8001,9000,S3,Kiosk shp,10,Vacant',
]
const CSV = Buffer.from([HEADER, ...ROWS, ''].join('\r\n'), 'utf8')

// The files share one world: remove the properties this file imports (their units and import records go with them),
// so suites that count company A's properties or units see only the world's own.
afterAll(async () => {
  const companyId = world().companies.a.id
  expectOk(await serviceRole().from('properties').delete().eq('company_id', companyId).in('code', ['IPA', 'IPB']), 'Delete this file’s properties')
})

async function upload(client: ApiClient, fileName: string, file: Buffer) {
  const target = await unwrap(client.POST('/api/v1/portfolio-imports/upload-url', { body: { fileName, sizeBytes: file.length } }))
  const put = await fetch(target.signedUrl, { method: 'PUT', headers: { 'content-type': target.contentType }, body: new Uint8Array(file) })
  expect(put.ok, `storage answered ${put.status}`).toBe(true)
  return unwrap(client.POST('/api/v1/portfolio-imports', { body: { scope: 'properties', storagePath: target.storagePath, fileName, sizeBytes: file.length } }))
}

const summaryOf = (client: ApiClient, importId: string) =>
  unwrap(client.GET('/api/v1/portfolio-imports/{importId}/summary', { params: { path: { importId } } }))
const approve = (client: ApiClient, importId: string, body: { accountingSystem?: 'MRI' | 'Sage' } = {}) =>
  client.POST('/api/v1/portfolio-imports/{importId}/approve', { params: { path: { importId } }, body })

describe('portfolio imports: approve and apply', () => {
  it('creates the approved properties and units once, audited as created by import, and never messages tenants', async () => {
    const manager = apiAs('manager', 'a')
    const managerId = world().users.manager.id
    const companyId = world().companies.a.id
    const db = serviceRole()
    const messagesBefore = check(await db.from('communications').select('id').eq('company_id', companyId), 'List communications').length

    const batch = await upload(manager, 'approve.csv', CSV)
    const before = await summaryOf(manager, batch.id)
    expect(before).toMatchObject({ propertiesToCreate: 2, unitsToCreate: 4, linkedRows: 0, skippedRows: 0, blockedRows: 1, canApprove: true, needsAccountingSystem: true, created: [] })
    expect(before.approval).toBeUndefined()

    // Only writers approve, and new properties need their accounting system.
    expect((await apiErrorOf(unwrap(approve(apiAs('readOnly', 'a'), batch.id, { accountingSystem: 'MRI' })))).status).toBe(403)
    expect((await apiErrorOf(unwrap(approve(apiAs('owner', 'a'), batch.id, { accountingSystem: 'MRI' })))).status).toBe(403)
    expect((await apiErrorOf(unwrap(approve(apiAs('manager', 'b'), batch.id, { accountingSystem: 'MRI' })))).status).toBe(404)
    expect((await apiErrorOf(unwrap(approve(manager, batch.id)))).status).toBe(422)
    expect(check(await db.from('properties').select('id').eq('company_id', companyId).in('code', ['IPA', 'IPB']), 'Look for imported')).toEqual([])

    const after = await unwrap(approve(manager, batch.id, { accountingSystem: 'MRI' }))
    expect(after).toMatchObject({ propertiesToCreate: 0, unitsToCreate: 0, linkedRows: 4, blockedRows: 1, canApprove: false, approval: { approvedByUserId: managerId } })
    expect(after.created.map((record) => [record.recordType, record.label, record.rowNumber])).toEqual([
      ['property', 'Import Park (IPA)', 2],
      ['unit', 'A1', 2],
      ['unit', 'A2', 3],
      ['property', 'Import Centre (IPB)', 4],
      ['unit', 'S1', 4],
      ['unit', 'S2', 5],
    ])

    const properties = check(
      await db.from('properties').select('id, code, manager_user_id, accounting_system, province').eq('company_id', companyId).in('code', ['IPA', 'IPB']).order('code'),
      'Read imported properties',
    )
    expect(properties.map((p) => [p.code, p.manager_user_id, p.accounting_system, p.province])).toEqual([
      ['IPA', managerId, 'MRI', 'Gauteng'],
      ['IPB', managerId, 'MRI', 'Western Cape'],
    ])
    const units = check(
      await db.from('units').select('unit_number, occupancy_status').eq('company_id', companyId).in('property_id', properties.map((p) => p.id)).order('unit_number'),
      'Read imported units',
    )
    expect(units).toEqual([
      { unit_number: 'A1', occupancy_status: 'vacant' },
      { unit_number: 'A2', occupancy_status: 'occupied' },
      { unit_number: 'S1', occupancy_status: 'vacant' },
      { unit_number: 'S2', occupancy_status: 'vacant' },
    ])

    // Each created record is audited as created by import, with the batch reference, by the approver.
    const audit = check(
      await db.from('audit_logs').select('actor_user_id, entity_type, summary, changes').eq('company_id', companyId).eq('action', 'create').like('summary', '%by import of approve.csv%'),
      'Read audit',
    )
    expect(audit).toHaveLength(6)
    expect(audit.every((entry) => entry.actor_user_id === managerId)).toBe(true)
    expect(audit.every((entry) => JSON.stringify(entry.changes).includes(batch.id))).toBe(true)
    const approval = check(await db.from('audit_logs').select('summary').eq('entity_id', batch.id).eq('action', 'approve'), 'Read approval audit')
    expect(approval).toEqual([{ summary: 'Portfolio file approve.csv approved: 2 properties and 4 units created' }])

    // Approving twice creates nothing.
    const again = await unwrap(approve(manager, batch.id, { accountingSystem: 'MRI' }))
    expect(again.created).toHaveLength(6)
    expect(check(await db.from('properties').select('id').eq('company_id', companyId).in('code', ['IPA', 'IPB']), 'Count').length).toBe(2)

    // The blocked row stays out until it is fixed; approving again then adds it alone.
    await unwrap(
      manager.PATCH('/api/v1/portfolio-imports/{importId}/rows/{rowNumber}', { params: { path: { importId: batch.id, rowNumber: 6 } }, body: { corrections: { unitType: 'Kiosk' } } }),
    )
    const fixed = await unwrap(approve(manager, batch.id))
    expect(fixed.created.map((record) => record.label)).toContain('S3')
    expect(fixed.created).toHaveLength(7)

    // Importing the same file again: every row matches, nothing is created.
    const second = await upload(manager, 'approve-again.csv', CSV)
    const secondSummary = await summaryOf(manager, second.id)
    expect(secondSummary).toMatchObject({ propertiesToCreate: 0, unitsToCreate: 0, linkedRows: 4, canApprove: false })
    expect((await unwrap(approve(manager, second.id, { accountingSystem: 'MRI' }))).created).toEqual([])
    expect(check(await db.from('units').select('id').eq('company_id', companyId).in('property_id', properties.map((p) => p.id)), 'Count units').length).toBe(5)

    // Importing never enables or sends tenant messaging.
    expect(check(await db.from('communications').select('id').eq('company_id', companyId), 'List communications').length).toBe(messagesBefore)
  })
})
