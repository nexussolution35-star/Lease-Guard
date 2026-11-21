import { unwrap, type ApiClient } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { apiAs, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * Tenants from the register (ticket I-05) through the real API and the local database: a file with tenant columns
 * proposes each unit's tenant; an exact account reference matches an existing tenant, a similar name only suggests one
 * until the manager confirms or rejects it; a tenant several rows name by its registration number is created once;
 * missing contact details are listed in the summary; approving creates the tenants through the tenant write path,
 * audited as created by import, with their WhatsApp numbers unvalidated; and no message is sent.
 */

const HEADER =
  'Property code,Property name,Property type,Address line 1,Suburb,City,Province,Postal code,Gross lettable area (m²),Unit number,Unit type,Floor area (m²),Unit status,' +
  'Tenant,Registered name,Reg no,Account no,Business type,Contact person,Email,Cell'
const PROPERTY = 'ITN,Import Tenants Centre,Shopping centre,7 Register Road,Rosebank,Johannesburg,Gauteng,2196,3000'
const ROWS = [
  `${PROPERTY},T1,Line shop,80,Occupied,Register Bean,Register Bean (Pty) Ltd,2016/111111/07,,,Thandi Mokoena,,082 123 4567`,
  `${PROPERTY},T2,Line shop,60,Occupied,Register Bean,Register Bean (Pty) Ltd,2016/111111/07,,,Thandi Mokoena,,082 123 4567`,
  `${PROPERTY},T3,Kiosk,12,Occupied,Somebody else,,,itn-acc-1,,,,`,
  `${PROPERTY},T4,Kiosk,10,Occupied,Register Existing Shop,Register Existing Shop CC,,,CC,Sipho,sipho@example.co.za,0831112222`,
]
const CSV = Buffer.from([HEADER, ...ROWS, ''].join('\r\n'), 'utf8')

// The files share one world: remove the property this file imports (its units and import records go with it) and
// the tenants it adds, so suites that count company A's properties, units or tenants see only the world's own.
afterAll(async () => {
  const companyId = world().companies.a.id
  const db = serviceRole()
  const imported = check(
    await db.from('portfolio_import_records').select('tenant_id, properties!inner(code)').eq('company_id', companyId).eq('record_type', 'tenant').eq('properties.code', 'ITN'),
    'List this file’s imported tenants',
  ).map((record) => record.tenant_id)
  const existing = check(await db.from('tenants').select('id').eq('company_id', companyId).eq('account_reference', 'ITN-ACC-1'), 'Find this file’s tenant').map((t) => t.id)
  expectOk(await db.from('properties').delete().eq('company_id', companyId).eq('code', 'ITN'), 'Delete this file’s property')
  const tenantIds = [...imported, ...existing].filter((id): id is string => typeof id === 'string')
  if (tenantIds.length > 0) expectOk(await db.from('tenants').delete().eq('company_id', companyId).in('id', tenantIds), 'Delete this file’s tenants')
})

async function upload(client: ApiClient, fileName: string, file: Buffer) {
  const target = await unwrap(client.POST('/api/v1/portfolio-imports/upload-url', { body: { fileName, sizeBytes: file.length } }))
  const put = await fetch(target.signedUrl, { method: 'PUT', headers: { 'content-type': target.contentType }, body: new Uint8Array(file) })
  expect(put.ok, `storage answered ${put.status}`).toBe(true)
  return unwrap(client.POST('/api/v1/portfolio-imports', { body: { scope: 'properties', storagePath: target.storagePath, fileName, sizeBytes: file.length } }))
}

describe('portfolio imports: tenants from the register', () => {
  it('proposes, matches and creates tenants with the batch, never on similar names alone, and never messages them', async () => {
    const manager = apiAs('manager', 'a')
    const companyId = world().companies.a.id
    const managerId = world().users.manager.id
    const db = serviceRole()
    const messagesBefore = check(await db.from('communications').select('id').eq('company_id', companyId), 'List communications').length

    // An existing tenant, with its account reference, through the tenant write API.
    const existing = await unwrap(
      manager.POST('/api/v1/tenants', {
        body: {
          legalName: 'Register Existing Shop (Pty) Ltd',
          tradingName: 'Register Existing Shop',
          businessType: 'pty_ltd',
          accountReference: 'ITN-ACC-1',
          primaryContact: { fullName: 'Lerato' },
          whatsappNumber: '082 555 0101',
        },
      }),
    )
    expect(existing.accountReference).toBe('ITN-ACC-1')

    const batch = await upload(manager, 'register.csv', CSV)
    const preview = await unwrap(manager.GET('/api/v1/portfolio-imports/{importId}/preview', { params: { path: { importId: batch.id }, query: { page: 1, pageSize: 25 } } }))
    expect(preview.items.map((row) => [row.rowNumber, row.result, row.tenant?.result, row.tenant?.sameAsRowNumber ?? null])).toEqual([
      [2, 'new', 'new', null],
      [3, 'new', 'new', 2],
      [4, 'new', 'match', null],
      [5, 'suggested', 'suggested', null],
    ])
    expect(preview.items[2]!.tenant).toMatchObject({ matchedBy: 'accountReference', tenant: { id: existing.id } })
    expect(preview.items[3]!.tenant!.suggestions.map((s) => s.id)).toEqual([existing.id])
    expect(preview.counts.suggested).toBe(1)

    const summaryOf = () => unwrap(manager.GET('/api/v1/portfolio-imports/{importId}/summary', { params: { path: { importId: batch.id } } }))
    expect(await summaryOf()).toMatchObject({
      propertiesToCreate: 1,
      unitsToCreate: 3,
      tenantsToCreate: 1,
      tenantsLinked: 1,
      tenantSuggestionsToReview: 1,
      blockedRows: 1,
      missingContactDetails: [{ rowNumber: 2, tenantName: 'Register Bean', missing: ['email'], blocksCreation: false }],
    })

    // The similar name is not the same tenant: the manager rejects the suggestion, so a new tenant is created.
    const rejected = await unwrap(
      manager.PATCH('/api/v1/portfolio-imports/{importId}/rows/{rowNumber}', {
        params: { path: { importId: batch.id, rowNumber: 5 } },
        body: { tenantMatch: { decision: 'rejected' } },
      }),
    )
    expect(rejected).toMatchObject({ result: 'new', tenant: { result: 'new' }, resolution: { tenantSuggestionsRejected: true, changedByUserId: managerId } })
    expect(await summaryOf()).toMatchObject({ unitsToCreate: 4, tenantsToCreate: 2, tenantSuggestionsToReview: 0, blockedRows: 0 })

    const after = await unwrap(manager.POST('/api/v1/portfolio-imports/{importId}/approve', { params: { path: { importId: batch.id } }, body: { accountingSystem: 'MRI' } }))
    const tenantsCreated = after.created.filter((record) => record.recordType === 'tenant')
    expect(tenantsCreated.map((record) => [record.label, record.unitNumber, record.rowNumber])).toEqual([
      ['Register Bean', 'T1', 2],
      ['Register Existing Shop', 'T4', 5],
    ])
    expect(after).toMatchObject({ tenantsToCreate: 0, canApprove: false })

    const created = check(
      await db.from('tenants').select('id, legal_name, business_type, whatsapp_number, whatsapp_verified, registration_number').in('id', tenantsCreated.map((record) => record.id)).order('legal_name'),
      'Read imported tenants',
    )
    expect(created.map((tenant) => [tenant.legal_name, tenant.business_type, tenant.whatsapp_number, tenant.whatsapp_verified, tenant.registration_number])).toEqual([
      ['Register Bean (Pty) Ltd', 'pty_ltd', '+27821234567', false, '2016/111111/07'],
      ['Register Existing Shop CC', 'close_corporation', '+27831112222', false, null],
    ])

    const audit = check(
      await db.from('audit_logs').select('actor_user_id, summary, changes').eq('entity_type', 'tenant').eq('action', 'create').in('entity_id', created.map((tenant) => tenant.id)),
      'Read tenant audit',
    )
    expect(audit).toHaveLength(2)
    expect(audit.every((entry) => entry.actor_user_id === managerId && entry.summary.includes('created by import of register.csv'))).toBe(true)
    expect(audit.every((entry) => JSON.stringify(entry.changes).includes(batch.id))).toBe(true)

    // Approving again creates nothing more; importing never sends WhatsApp or any other message.
    expect((await unwrap(manager.POST('/api/v1/portfolio-imports/{importId}/approve', { params: { path: { importId: batch.id } }, body: {} }))).created).toHaveLength(after.created.length)
    expect(check(await db.from('communications').select('id').eq('company_id', companyId), 'List communications').length).toBe(messagesBefore)
  })
})
