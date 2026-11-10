import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * Meta-side disconnects and template status changes (ticket 06) against the real API and database. Company A has a
 * number connected through Embedded Signup (its token in Vault); company B has its own connected number and, in
 * addition, typed A's account id for a number it never verified. The worker's database side runs through the same
 * service-role functions the worker calls (remove_whatsapp_business_account_access, apply_whatsapp_template_status);
 * the worker's webhook parsing and Meta calls are unit-tested with fakes (backend/src/workers/whatsapp). Members then
 * read the result through the API: only A's number is disconnected, A's token is gone, A's admin is notified.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const ACCOUNT_A = `${unique}1`
const ACCOUNT_B = `${unique}2`
const PHONE_A = `${unique}3`
const PHONE_B = `${unique}4`
const PHONE_B_TYPED = `${unique}5`
const TEMPLATE_ID = `${unique}6`

let secretId: string

async function numbersOf(company: 'a' | 'b') {
  const user = company === 'a' ? 'readOnly' : 'manager'
  const accounts = await unwrap(apiAs(user, company).GET('/api/v1/integrations/whatsapp/business-accounts'))
  return accounts.flatMap((a) => a.numbers)
}

async function addNumber(company: 'a' | 'b', account: string, phone: string, status: 'connected' | 'pending_verification', reference?: string) {
  const db = serviceRole()
  const companyId = world().companies[company].id
  expectOk(
    await db
      .from('whatsapp_business_accounts')
      .upsert({ company_id: companyId, business_account_id: account, ...(reference ? { access_token_reference: reference } : {}) }, { onConflict: 'company_id,business_account_id' }),
    'Insert the account',
  )
  expectOk(
    await db.from('whatsapp_phone_numbers').insert({
      company_id: companyId,
      business_account_id: account,
      phone_number_id: phone,
      display_name: `Company ${company.toUpperCase()}`,
      display_number: `+27 11 555 ${phone.slice(-4)}`,
      connection_status: status,
      webhook_configured: status === 'connected',
      last_verified_at: status === 'connected' ? new Date(Date.now() - 60_000).toISOString() : null,
      ...(reference ? { access_token_reference: reference } : {}),
    }),
    'Insert the number',
  )
}

beforeAll(async () => {
  const companyA = world().companies.a.id
  const [secret] = (await localSql(
    `select vault.create_secret('EAAG-it-disconnect-token-${unique}', 'whatsapp_access_token:${companyA}:onboarding:it-${unique}') as id`,
  )) as { id: string }[]
  secretId = secret!.id
  await addNumber('a', ACCOUNT_A, PHONE_A, 'connected', `secret://vault/${secretId}`)
  await addNumber('b', ACCOUNT_B, PHONE_B, 'connected')
  await addNumber('b', ACCOUNT_A, PHONE_B_TYPED, 'pending_verification')
  expectOk(
    await serviceRole().from('whatsapp_message_templates').insert({
      company_id: companyA,
      business_account_id: ACCOUNT_A,
      meta_template_id: TEMPLATE_ID,
      name: `it_statement_${unique}`,
      language: 'en',
      category: 'UTILITY',
      status: 'APPROVED',
      synced_at: new Date(Date.now() - 3_600_000).toISOString(),
    }),
    'Insert the synced template',
  )
})

afterAll(async () => {
  const db = serviceRole()
  const companyIds = [world().companies.a.id, world().companies.b.id]
  expectOk(await db.from('notifications').delete().in('company_id', companyIds).like('dedupe_key', 'whatsapp-access-removed:%'), 'Delete notifications')
  expectOk(await db.from('whatsapp_message_templates').delete().eq('meta_template_id', TEMPLATE_ID), 'Delete the template')
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', [PHONE_A, PHONE_B, PHONE_B_TYPED]), 'Delete the numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', [ACCOUNT_A, ACCOUNT_B]), 'Delete the accounts')
  if (secretId) await localSql(`delete from vault.secrets where id = '${secretId}'`)
})

describe('Meta template status changes', () => {
  it("show on the integration page of the account's company, in Meta's order", async () => {
    const apply = async (status: string, at: Date) =>
      check(
        await serviceRole().rpc('apply_whatsapp_template_status', {
          p_business_account_id: ACCOUNT_A,
          p_meta_template_id: TEMPLATE_ID,
          p_name: null,
          p_language: null,
          p_category: null,
          p_status: status,
          p_reason: status === 'PAUSED' ? 'Low quality' : null,
          p_occurred_at: at.toISOString(),
        }),
        'Apply a template status',
      )
    expect(await apply('PAUSED', new Date())).toEqual([{ company_id: world().companies.a.id, outcome: 'updated' }])
    expect(await apply('APPROVED', new Date(Date.now() - 600_000))).toEqual([{ company_id: world().companies.a.id, outcome: 'stale' }])

    const templates = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(templates.find((t) => t.metaTemplateId === TEMPLATE_ID)).toMatchObject({ status: 'PAUSED', rejectedReason: 'Low quality', statusUpdatedAt: expect.any(String) })
    const other = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(other.some((t) => t.metaTemplateId === TEMPLATE_ID)).toBe(false)
  })
})

describe('An account event without entry.time', () => {
  // Meta may omit entry.time; the worker then leaves p_occurred_at out of the call (an undefined key is dropped by
  // supabase-js). PostgREST must still find the functions (it answered PGRST202 before the parameter had a default).
  it('reaches both functions through PostgREST, applied at the time it is processed', async () => {
    const unknownAccount = `${unique}9`
    expect(
      check(await serviceRole().rpc('remove_whatsapp_business_account_access', { p_business_account_id: unknownAccount, p_event: 'ACCOUNT_DELETED' }), 'Remove access without a time'),
    ).toEqual([])
    expect(
      check(
        await serviceRole().rpc('apply_whatsapp_template_status', {
          p_business_account_id: ACCOUNT_A,
          p_meta_template_id: TEMPLATE_ID,
          p_name: null,
          p_language: null,
          p_category: null,
          p_status: 'PAUSED',
          p_reason: null,
        }),
        'Apply a template status without a time',
      ),
      // updated or stale: the previous test applied a status at this machine's time, which may be ahead of the database's now().
    ).toEqual([{ company_id: world().companies.a.id, outcome: expect.stringMatching(/^(updated|stale)$/) }])
  })

  it('refuses an event that is not a Meta template status, leaving the template as it is', async () => {
    const { error } = await serviceRole().rpc('apply_whatsapp_template_status', {
      p_business_account_id: ACCOUNT_A,
      p_meta_template_id: TEMPLATE_ID,
      p_name: null,
      p_language: null,
      p_category: null,
      p_status: 'UNARCHIVED',
      p_reason: null,
    })
    expect(error?.code).toBe('22023')
    const templates = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(templates.find((t) => t.metaTemplateId === TEMPLATE_ID)?.status).toBe('PAUSED')
  })
})

describe('Meta-side uninstall', () => {
  it("disconnects only the account holder's number, deletes its token and notifies its admin", async () => {
    const result = check(
      await serviceRole().rpc('remove_whatsapp_business_account_access', {
        p_business_account_id: ACCOUNT_A,
        p_event: 'PARTNER_APP_UNINSTALLED',
        p_occurred_at: new Date().toISOString(),
      }),
      'Remove access',
    )
    expect(result).toEqual([{ company_id: world().companies.a.id, numbers_disconnected: 1, token_removed: true, admins_notified: 1 }])

    const a = (await numbersOf('a')).find((n) => n.phoneNumberId === PHONE_A)
    expect(a).toMatchObject({
      connectionStatus: 'disconnected',
      webhookConfigured: false,
      disconnectedAt: expect.any(String),
      disconnectedReason: expect.stringContaining('removed LeaseGuard'),
    })
    expect(await localSql(`select count(*)::int as n from vault.secrets where id = '${secretId}'`)).toEqual([{ n: 0 }])

    const b = await numbersOf('b')
    expect(b.find((n) => n.phoneNumberId === PHONE_B)).toMatchObject({ connectionStatus: 'connected' })
    expect(b.find((n) => n.phoneNumberId === PHONE_B_TYPED)).toMatchObject({ connectionStatus: 'pending_verification' })
    expect(b.find((n) => n.phoneNumberId === PHONE_B_TYPED)?.disconnectedReason).toBeUndefined()

    const notifications = await unwrap(apiAs('admin', 'a').GET('/api/v1/notifications', { params: { query: { pageSize: 100 } } }))
    const removed = notifications.items.filter((n) => n.title === 'WhatsApp disconnected in Meta' && n.body.includes(ACCOUNT_A))
    expect(removed).toHaveLength(1)
    // Its token was in Vault and deleted, so the admin is told so (and only then).
    expect(removed[0]!.body).toContain('deleted its stored access token.')
    const managerB = await unwrap(apiAs('manager', 'b').GET('/api/v1/notifications', { params: { query: { pageSize: 100 } } }))
    expect(managerB.items.some((n) => n.body.includes(ACCOUNT_A))).toBe(false)
  })

  it('applies a retried uninstall once', async () => {
    const again = check(
      await serviceRole().rpc('remove_whatsapp_business_account_access', {
        p_business_account_id: ACCOUNT_A,
        p_event: 'PARTNER_APP_UNINSTALLED',
        p_occurred_at: new Date().toISOString(),
      }),
      'Remove access again',
    )
    expect(again).toEqual([])
  })
})
