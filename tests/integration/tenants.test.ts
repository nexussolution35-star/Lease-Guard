import { unwrap } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { auditCount } from './support/local-db.ts'

/**
 * Tenant create and edit (PRD module 4, M4-01) through the real API and the local database: writers create and edit
 * tenants; the WhatsApp number is stored in E.164, starts unvalidated and is unvalidated again whenever it changes;
 * invalid numbers are refused with the format to use; members who only read are refused; another company's tenant is
 * not found; and every change reaches the audit log. Writers validate the number on record (M4-03), which records who
 * did it and when.
 */

/** Tenants this file creates, removed afterwards so later files see the world's set. */
const created: string[] = []

afterAll(async () => {
  if (created.length) expectOk(await serviceRole().from('tenants').delete().in('id', created), 'Delete this file’s tenants')
})

const newTenant = (name: string) => ({
  legalName: `${name} ${integration().runId} (Pty) Ltd`,
  tradingName: `${name} ${integration().runId}`,
  businessType: 'pty_ltd' as const,
  primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner' },
  whatsappNumber: '082 555 0199',
  email: 'Accounts@Example.co.za',
  status: 'active' as const,
  industry: 'Retail',
})

/** The latest audit entry of a tenant, read as the database owner. */
async function latestAudit(entityId: string): Promise<{ action: string; summary: string; changes: unknown }> {
  const rows = await localSql(
    `select action::text, summary, changes from public.audit_logs where entity_id = '${entityId}' order by occurred_at desc, id desc limit 1`,
  )
  return rows[0] as { action: string; summary: string; changes: unknown }
}

/** Marks a tenant's number validated as the service role (a background job's path; members use the validation endpoint). */
async function markValidated(tenantId: string): Promise<void> {
  expectOk(await serviceRole().from('tenants').update({ whatsapp_verified: true }).eq('id', tenantId), 'Validate the number')
}

describe('tenants: create', () => {
  it('lets a property manager create a tenant with the number in E.164, unvalidated, and audits it', async () => {
    const tenant = await unwrap(apiAs('manager', 'a').POST('/api/v1/tenants', { body: newTenant('Soweto Shoes') }))
    created.push(tenant.id)
    expect(tenant).toMatchObject({
      companyId: world().companies.a.id,
      whatsappNumber: '+27825550199',
      whatsappVerified: false,
      whatsappOptedOut: false,
      email: 'accounts@example.co.za',
      status: 'active',
      primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner', phone: '+27825550199' },
    })
    expect(await auditCount(tenant.id)).toBe(1)
    expect(await latestAudit(tenant.id)).toMatchObject({ action: 'create', summary: `Tenant ${tenant.tradingName} created` })

    const fetched = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: tenant.id } } }))
    expect(fetched.whatsappNumber).toBe('+27825550199')
  })

  it('refuses an invalid number with a clear message (400) and members who only read (403)', async () => {
    const invalid = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/tenants', { body: { ...newTenant('Bad Number'), whatsappNumber: '12345' } })))
    expect(invalid.status).toBe(400)
    expect(invalid.messages).toEqual(['whatsappNumber: Enter the WhatsApp number with its country code, for example +27 82 123 4567'])

    const validated = await apiErrorOf(
      unwrap(apiAs('admin', 'a').POST('/api/v1/tenants', { body: { ...newTenant('Self Validated'), whatsappVerified: true } as never })),
    )
    expect(validated.status).toBe(400)

    for (const user of ['readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/tenants', { body: newTenant('Refused') })))).status).toBe(403)
    }
  })
})

describe('tenants: edit', () => {
  const tenantId = () => {
    const id = created[0]
    if (!id) throw new Error('The create test did not run or failed')
    return id
  }

  it('edits only the fields sent and audits the change, leaving validation alone', async () => {
    const before = await auditCount(tenantId())
    await markValidated(tenantId())
    const edited = await unwrap(
      apiAs('admin', 'a').PATCH('/api/v1/tenants/{tenantId}', {
        params: { path: { tenantId: tenantId() } },
        body: { primaryContact: { fullName: 'Thandeka Mabena' }, notes: 'Prefers WhatsApp', email: null },
      }),
    )
    expect(edited).toMatchObject({ primaryContact: { fullName: 'Thandeka Mabena', role: 'Owner' }, notes: 'Prefers WhatsApp', whatsappVerified: true })
    expect(edited).not.toHaveProperty('email')
    expect(await auditCount(tenantId())).toBe(before + 2) // the validation above, then this edit
  })

  it('resets validation when the number changes, and audits the old and new number', async () => {
    const edited = await unwrap(
      apiAs('manager', 'a').PATCH('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: tenantId() } }, body: { whatsappNumber: '+27 82 555 0111' } }),
    )
    expect(edited).toMatchObject({ whatsappNumber: '+27825550111', whatsappVerified: false })
    expect(await latestAudit(tenantId())).toEqual({
      action: 'update',
      summary: `Tenant ${edited.tradingName}: WhatsApp number changed; it must be validated again`,
      changes: [
        { field: 'whatsapp_number', before: '+27825550199', after: '+27825550111' },
        { field: 'whatsapp_verified', before: true, after: false },
      ],
    })

    const invalid = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: tenantId() } }, body: { whatsappNumber: '+27 082 555 0111' } })),
    )
    expect(invalid.status).toBe(400)
    expect(invalid.messages).toEqual(['whatsappNumber: A South African WhatsApp number has nine digits after +27, for example +27 82 123 4567'])
  })

  it('refuses writes from members who only read (403) and does not find another company’s tenant (404)', async () => {
    const path = { params: { path: { tenantId: tenantId() } } }
    const audits = await auditCount(tenantId())
    for (const user of ['readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').PATCH('/api/v1/tenants/{tenantId}', { ...path, body: { notes: 'X' } })))).status).toBe(403)
    }
    // The manager also manages company B: under B, A's tenant does not exist.
    expect((await apiErrorOf(unwrap(apiAs('manager', 'b').PATCH('/api/v1/tenants/{tenantId}', { ...path, body: { whatsappNumber: '+27825550112' } })))).status).toBe(404)
    // The admin of A is not a member of B.
    expect((await apiErrorOf(unwrap(apiAs('admin', 'b').PATCH('/api/v1/tenants/{tenantId}', { ...path, body: { notes: 'X' } })))).status).toBe(403)

    const unchanged = await unwrap(apiAs('manager', 'a').GET('/api/v1/tenants/{tenantId}', path))
    expect(unchanged).toMatchObject({ whatsappNumber: '+27825550111', notes: 'Prefers WhatsApp' })
    expect(await auditCount(tenantId())).toBe(audits)
  })
})

describe('tenants: WhatsApp validation', () => {
  const tenantId = () => {
    const id = created[0]
    if (!id) throw new Error('The create test did not run or failed')
    return id
  }
  const validate = (user: 'admin' | 'manager' | 'readOnly' | 'owner', company: 'a' | 'b', whatsappNumber: string) =>
    unwrap(
      apiAs(user, company).POST('/api/v1/tenants/{tenantId}/whatsapp-validation', {
        params: { path: { tenantId: tenantId() } },
        body: { whatsappNumber },
      }),
    )

  it('refuses members who only read (403), another company (404) and a number that is not the one on record (409)', async () => {
    const audits = await auditCount(tenantId())
    for (const user of ['readOnly', 'owner'] as const) expect((await apiErrorOf(validate(user, 'a', '+27825550111'))).status).toBe(403)
    expect((await apiErrorOf(validate('manager', 'b', '+27825550111'))).status).toBe(404)
    const stale = await apiErrorOf(validate('manager', 'a', '+27825550199'))
    expect(stale.status).toBe(409)
    expect(stale.messages.join(' ')).toMatch(/changed since it was checked/)
    expect((await apiErrorOf(validate('manager', 'a', '12345'))).status).toBe(400)

    const unchanged = await unwrap(apiAs('manager', 'a').GET('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: tenantId() } } }))
    expect(unchanged.whatsappVerified).toBe(false)
    expect(await auditCount(tenantId())).toBe(audits)
  })

  it('lets a property manager validate the number on record, typed as people write it, and records who and when', async () => {
    const validated = await validate('manager', 'a', '082 555 0111')
    expect(validated).toMatchObject({ whatsappNumber: '+27825550111', whatsappVerified: true, whatsappValidatedByUserId: world().users.manager.id })
    expect(Date.parse(validated.whatsappValidatedAt ?? '')).not.toBeNaN()
    expect(await latestAudit(tenantId())).toEqual({
      action: 'verify',
      summary: `Tenant ${validated.tradingName}: WhatsApp number +27825550111 validated`,
      changes: [{ field: 'whatsapp_verified', before: false, after: true }],
    })

    const audits = await auditCount(tenantId())
    expect(await validate('admin', 'a', '+27825550111')).toMatchObject({ whatsappVerified: true, whatsappValidatedByUserId: world().users.manager.id })
    expect(await auditCount(tenantId())).toBe(audits)
  })

  it('clears the validation and who did it when the number changes', async () => {
    const edited = await unwrap(
      apiAs('admin', 'a').PATCH('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: tenantId() } }, body: { whatsappNumber: '082 555 0122' } }),
    )
    expect(edited.whatsappVerified).toBe(false)
    expect(edited).not.toHaveProperty('whatsappValidatedAt')
    expect(edited).not.toHaveProperty('whatsappValidatedByUserId')
  })
})
