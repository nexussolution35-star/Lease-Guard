import { unwrap } from '@leaseguard/api-client'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Settings → Integrations → WhatsApp against the real API and database: several business accounts and
 * numbers per company, isolated by company (through the API and directly through PostgREST with a
 * member's own sign-in), the credential reference never readable, and the public-safe capabilities.
 */

interface CreatedNumber {
  company: 'a' | 'b'
  businessAccountId: string
  phoneNumberId: string
  status: 'connected' | 'pending_verification'
}

const run = () => integration().runId.replace(/[^0-9a-z]/gi, '').slice(-12)
let numbers: CreatedNumber[] = []

/** Numeric Meta ids for the PUT tests (the API accepts digits only), unique per run. */
const putIdBase = `${Date.now()}${Math.floor(Math.random() * 1_000_000)
  .toString()
  .padStart(6, '0')}`
const putId = (n: number) => `${putIdBase}${n}`

/** A member's own PostgREST session (anon key + their access token): Row Level Security applies. */
function postgrestAs(user: 'readOnly' | 'manager') {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens[user]}` } },
  })
}

beforeAll(async () => {
  numbers = [
    { company: 'a', businessAccountId: `waba-a1-${run()}`, phoneNumberId: `pn-a1-${run()}`, status: 'connected' },
    { company: 'a', businessAccountId: `waba-a1-${run()}`, phoneNumberId: `pn-a2-${run()}`, status: 'pending_verification' },
    { company: 'a', businessAccountId: `waba-a2-${run()}`, phoneNumberId: `pn-a3-${run()}`, status: 'pending_verification' },
    { company: 'b', businessAccountId: `waba-b1-${run()}`, phoneNumberId: `pn-b1-${run()}`, status: 'connected' },
  ]
  // As the service role records verified numbers (Embedded Signup and verification do this later); the
  // database records each number's business account.
  expectOk(
    await serviceRole()
      .from('whatsapp_phone_numbers')
      .insert(
        numbers.map((n) => ({
          company_id: world().companies[n.company].id,
          business_account_id: n.businessAccountId,
          phone_number_id: n.phoneNumberId,
          display_name: `Number ${n.phoneNumberId}`,
          display_number: '+27 11 555 0100',
          connection_status: n.status,
        })),
      ),
    'Add WhatsApp numbers to companies A and B',
  )
})

afterAll(async () => {
  const db = serviceRole()
  const putPhones = [putId(1), putId(2)]
  const putAccounts = [putId(3), putId(4)]
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', putPhones), 'Delete the numbers added through PUT')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', putAccounts), 'Delete the PUT business accounts')
  const phoneIds = numbers.map((n) => n.phoneNumberId)
  const accountIds = [...new Set(numbers.map((n) => n.businessAccountId))]
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', phoneIds), 'Delete the numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', accountIds), 'Delete the business accounts')
  const left = check(await db.from('whatsapp_business_accounts').select('id').in('business_account_id', accountIds), 'Re-read accounts')
  expect(left).toEqual([])
})

describe('WhatsApp integration status', () => {
  it("lists the company's business accounts and numbers with their status, to any member", async () => {
    const accounts = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
    // Only this file's accounts (approvals.test.ts also connects a number in company A).
    const mine = accounts.filter((a) => /^waba-a[0-9]-/.test(a.businessAccountId) && a.businessAccountId.endsWith(run()))

    // Inserted in one statement, so the accounts (recorded by the trigger) and the numbers share a creation
    // time and the API breaks the tie by their random uuid; compare them by Meta id.
    const byNumber = (a: { phoneNumberId: string }, b: { phoneNumberId: string }) => a.phoneNumberId.localeCompare(b.phoneNumberId)
    const byAccount = (a: { businessAccountId: string }, b: { businessAccountId: string }) => a.businessAccountId.localeCompare(b.businessAccountId)
    expect([...mine].sort(byAccount).map((a) => [a.businessAccountId, [...a.numbers].sort(byNumber).map((n) => [n.phoneNumberId, n.connectionStatus])])).toEqual([
      [`waba-a1-${run()}`, [[`pn-a1-${run()}`, 'connected'], [`pn-a2-${run()}`, 'pending_verification']]],
      [`waba-a2-${run()}`, [[`pn-a3-${run()}`, 'pending_verification']]],
    ])
    expect(JSON.stringify(accounts)).not.toMatch(/secret:|accessToken|access_token/)
  })

  it("never shows another company's accounts or numbers", async () => {
    const a = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(JSON.stringify(a)).not.toContain(`waba-b1-${run()}`)
    expect(JSON.stringify(a)).not.toContain(`pn-b1-${run()}`)

    // The manager belongs to both companies: under B only B's number.
    const b = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(b.flatMap((account) => account.numbers.map((n) => n.phoneNumberId))).toEqual([`pn-b1-${run()}`])

    const forbidden = await apiErrorOf(unwrap(apiAs('admin', 'b').GET('/api/v1/integrations/whatsapp/business-accounts')))
    expect(forbidden.status).toBe(403)
  })

  it("keeps members out of other companies' rows and every member out of the credential reference, also through PostgREST", async () => {
    const reader = postgrestAs('readOnly')
    const other = await reader.from('whatsapp_phone_numbers').select('id').eq('company_id', world().companies.b.id)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
    const otherAccounts = await reader.from('whatsapp_business_accounts').select('id').eq('company_id', world().companies.b.id)
    expect(otherAccounts.data).toEqual([])

    const credential = await reader.from('whatsapp_phone_numbers').select('access_token_reference').eq('company_id', world().companies.a.id)
    expect(credential.error?.code).toBe('42501')
  })

  it('summarises the numbers on the company without the credential reference', async () => {
    const company = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/companies/{companyId}', { params: { path: { companyId: world().companies.a.id } } }),
    )
    expect(company.whatsapp.connectionStatus).toBe('connected')
    expect(company.whatsapp.numberCount).toBeGreaterThanOrEqual(3)
    expect(company.whatsapp.connectedNumberCount).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(company)).not.toMatch(/secret:|accessTokenReference/)
  })

  it('reports the capabilities without secrets; this run configures no Meta settings and runs no worker', async () => {
    const capabilities = await unwrap(apiAs('readOnly').GET('/api/v1/integrations/whatsapp/capabilities'))
    expect(capabilities).toMatchObject({
      embeddedSignupConfigured: false,
      webhookConfigured: false,
      agentRuntimeConfigured: false,
      workerReporting: false,
    })
    expect(capabilities).not.toHaveProperty('workerReportedAt')
    // No worker reported, so the agent runtime is unknown: ANTHROPIC_API_KEY is not blamed.
    expect(capabilities.missing.map((m) => `${m.capability}:${m.setting}:${m.process}`)).toEqual([
      'embedded_signup:WHATSAPP_APP_ID:api',
      'embedded_signup:WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID:api',
      'embedded_signup:WHATSAPP_APP_SECRET:api',
      'webhook:WHATSAPP_APP_SECRET:api',
      'webhook:WHATSAPP_WEBHOOK_VERIFY_TOKEN:api',
    ])

    const anonymous = await apiErrorOf(unwrap(apiAs(null).GET('/api/v1/integrations/whatsapp/capabilities')))
    expect(anonymous.status).toBe(401)
  })

  describe('PUT /companies/:id/whatsapp', () => {
    const companyA = () => world().companies.a.id
    const put = (user: 'admin' | 'readOnly', body: Record<string, string>) =>
      unwrap(
        apiAs(user, 'a').PUT('/api/v1/companies/{companyId}/whatsapp', {
          params: { path: { companyId: companyA() } },
          body: { displayName: 'Front desk', displayNumber: '+27 11 555 0199', businessAccountId: '', phoneNumberId: '', ...body },
        }),
      )
    const mineOf = async () =>
      (await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))).filter((a) =>
        [putId(3), putId(4)].includes(a.businessAccountId),
      )

    it('adds a number pending verification, without the credential reference, under the column grants', async () => {
      const number = await put('admin', { businessAccountId: putId(3), phoneNumberId: putId(1) })
      expect(number).toMatchObject({ businessAccountId: putId(3), phoneNumberId: putId(1), connectionStatus: 'pending_verification' })
      expect(JSON.stringify(number)).not.toMatch(/secret:|accessToken|access_token/)
      expect((await mineOf()).map((a) => [a.businessAccountId, a.numbers.map((n) => n.phoneNumberId)])).toEqual([[putId(3), [putId(1)]]])
    })

    it('corrects a mistyped number by its LeaseGuard id: no second number and no empty business account', async () => {
      const [account] = await mineOf()
      const numberId = account!.numbers[0]!.id

      const corrected = await put('admin', { numberId, businessAccountId: putId(4), phoneNumberId: putId(2) })
      expect(corrected).toMatchObject({ id: numberId, businessAccountId: putId(4), phoneNumberId: putId(2), connectionStatus: 'pending_verification' })

      expect((await mineOf()).map((a) => [a.businessAccountId, a.numbers.map((n) => [n.id, n.phoneNumberId])])).toEqual([
        [putId(4), [[numberId, putId(2)]]],
      ])
    })

    it("answers 404 for a numberId of another company's number, and 403 to a read-only member", async () => {
      const other = check(
        await serviceRole().from('whatsapp_phone_numbers').select('id').eq('phone_number_id', `pn-b1-${run()}`).single(),
        "Read company B's number",
      )
      const notMine = await apiErrorOf(put('admin', { numberId: other.id, businessAccountId: putId(4), phoneNumberId: putId(2) }))
      expect(notMine.status).toBe(404)
      const stillB = check(await serviceRole().from('whatsapp_phone_numbers').select('phone_number_id').eq('id', other.id).single(), 'Re-read')
      expect(stillB.phone_number_id).toBe(`pn-b1-${run()}`)

      const readOnly = await apiErrorOf(put('readOnly', { businessAccountId: putId(3), phoneNumberId: putId(1) }))
      expect(readOnly.status).toBe(403)
    })
  })
})
