import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { RedisConnection } from '../fixtures/redis.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Number verification (ticket 04) against the real API, database and Redis: company admins ask the worker to
 * verify a number, hand it the registration PIN through a single-use Redis key (never the job, never the
 * database), are refused while Meta's registration lock lasts, and disconnect a number, which deletes its
 * token from Vault. The worker's database side (step results, the status decision, template sync) runs
 * through the same service-role functions the worker calls; the worker's Meta calls are unit-tested with
 * fakes (backend/src/workers/whatsapp). No worker consumes the queue here, and nothing calls Meta.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const ACCOUNT_ID = `${unique}1`
const PHONE_ID = `${unique}2`
const PIN = '482915'
const STEPS = ['token_scopes', 'phone_number', 'webhook_subscription', 'registration', 'message_templates'] as const

let numberId: string
let secretId: string
let redis: RedisConnection

const verify = (user: 'admin' | 'manager' | 'readOnly', company: 'a' | 'b' = 'a') =>
  unwrap(apiAs(user, company).POST('/api/v1/integrations/whatsapp/numbers/{numberId}/verify', { params: { path: { numberId } } }))
const register = (pin: string, user: 'admin' | 'manager' = 'admin') =>
  unwrap(apiAs(user, 'a').POST('/api/v1/integrations/whatsapp/numbers/{numberId}/register', { params: { path: { numberId } }, body: { pin } }))

const jobKey = () => `${integration().queuePrefix}:whatsapp-number-verification:whatsapp-number-verification.${world().companies.a.id}.${numberId}`
const pinKey = () => `${integration().queuePrefix}:whatsapp-registration-pin:${world().companies.a.id}:${numberId}`

/** What the worker records, through the same service-role writes it uses. */
async function recordSteps(statuses: Partial<Record<(typeof STEPS)[number], string>>) {
  const rows = STEPS.map((step) => ({
    company_id: world().companies.a.id,
    number_id: numberId,
    step,
    status: statuses[step] ?? 'passed',
    message: `${step} ${statuses[step] ?? 'passed'}`,
    checked_at: new Date().toISOString(),
  }))
  expectOk(await serviceRole().from('whatsapp_number_verification_steps').upsert(rows, { onConflict: 'number_id,step' }), 'Record steps')
  return check(
    await serviceRole().rpc('finish_whatsapp_number_verification', { p_company_id: world().companies.a.id, p_number_id: numberId }),
    'Finish verification',
  )
}

async function listedNumber(user: 'admin' | 'readOnly' = 'readOnly') {
  const accounts = await unwrap(apiAs(user, 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
  return accounts.flatMap((a) => a.numbers).find((n) => n.id === numberId)
}

beforeAll(async () => {
  redis = await RedisConnection.open(integration().redisUrl)
  const companyId = world().companies.a.id
  const [secret] = (await localSql(
    `select vault.create_secret('EAAG-it-verification-token-${unique}', 'whatsapp_access_token:${companyId}:onboarding:it-${unique}') as id`,
  )) as { id: string }[]
  secretId = secret!.id
  const reference = `secret://vault/${secretId}`
  expectOk(
    await serviceRole().from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: ACCOUNT_ID, access_token_reference: reference }),
    'Insert the account',
  )
  const number = check(
    await serviceRole()
      .from('whatsapp_phone_numbers')
      .insert({
        company_id: companyId,
        business_account_id: ACCOUNT_ID,
        phone_number_id: PHONE_ID,
        display_name: '',
        display_number: '',
        access_token_reference: reference,
        connection_status: 'pending_verification',
      })
      .select('id')
      .single(),
    'Insert the number',
  ) as { id: string }
  numberId = number.id
})

afterAll(async () => {
  redis?.close()
  const db = serviceRole()
  expectOk(await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', PHONE_ID), 'Delete the number')
  expectOk(await db.from('whatsapp_business_accounts').delete().eq('business_account_id', ACCOUNT_ID), 'Delete the account')
  if (secretId) await localSql(`delete from vault.secrets where id = '${secretId}'`)
})

describe('WhatsApp number verification', () => {
  it('lets only company admins of the company ask for a verification, which is queued once per number', async () => {
    expect((await apiErrorOf(verify('readOnly'))).status).toBe(403)
    expect((await apiErrorOf(verify('manager'))).status).toBe(403)
    expect([403, 404]).toContain((await apiErrorOf(verify('manager', 'b'))).status)

    await expect(verify('admin')).resolves.toMatchObject({ numberId, status: 'queued' })
    await expect(verify('admin')).resolves.toMatchObject({ numberId, status: 'already_running' })
    const data = await redis.command('HGET', jobKey(), 'data')
    expect(JSON.parse(String(data))).toEqual({ companyId: world().companies.a.id, numberId })
  })

  it('hands the PIN to the worker through a short-lived Redis key only: never the job, the database or a response', async () => {
    expect((await apiErrorOf(register('12345'))).status).toBe(400)
    expect((await apiErrorOf(register(PIN, 'manager'))).status).toBe(403)

    const result = await register(PIN)
    expect(result).toMatchObject({ numberId })
    expect(JSON.stringify(result)).not.toContain(PIN)
    expect(await redis.command('GET', pinKey())).toBe(PIN)
    const ttl = Number(await redis.command('TTL', pinKey()))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(600)
    expect(String(await redis.command('HGET', jobKey(), 'data'))).not.toContain(PIN)

    const stored = (await localSql(
      `select count(*)::int as n from public.whatsapp_phone_numbers n where n.id = '${numberId}' and n::text like '%${PIN}%'`,
    )) as { n: number }[]
    expect(stored[0]?.n).toBe(0)
    await redis.command('DEL', pinKey())
  })

  it("refuses registration with 429 while Meta's lock lasts, without handing a PIN over", async () => {
    const until = new Date(Date.now() + 72 * 3600_000).toISOString()
    expectOk(await serviceRole().from('whatsapp_phone_numbers').update({ registration_blocked_until: until }).eq('id', numberId), 'Lock registration')
    const error = await apiErrorOf(register(PIN))
    expect(error.status).toBe(429)
    expect(error.message).toMatch(/locked registration of this number/)
    expect(await redis.command('EXISTS', pinKey())).toBe(0)
    expect((await listedNumber())?.registrationBlockedUntil).toBeDefined()
    expectOk(await serviceRole().from('whatsapp_phone_numbers').update({ registration_blocked_until: null }).eq('id', numberId), 'Unlock registration')
  })

  it('shows which step failed and keeps the number unconnected until every step passed', async () => {
    expect(await recordSteps({ registration: 'action_needed' })).toBe('pending_verification')
    let number = await listedNumber()
    expect(number?.connectionStatus).toBe('pending_verification')
    expect(number?.verificationSteps.map((s) => [s.step, s.status])).toEqual([
      ['token_scopes', 'passed'],
      ['phone_number', 'passed'],
      ['webhook_subscription', 'passed'],
      ['registration', 'action_needed'],
      ['message_templates', 'passed'],
    ])

    expect(await recordSteps({ webhook_subscription: 'failed' })).toBe('error')
    number = await listedNumber()
    expect(number?.connectionStatus).toBe('error')
    expect(number?.verificationSteps.find((s) => s.status === 'failed')?.step).toBe('webhook_subscription')

    expect(await recordSteps({ registration: 'not_required' })).toBe('connected')
    number = await listedNumber()
    expect(number).toMatchObject({ connectionStatus: 'connected', webhookConfigured: true })
    expect(number?.lastVerifiedAt).toBeDefined()

    const other = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(JSON.stringify(other)).not.toContain(PHONE_ID)
  })

  it("lists the account's synced templates with category, language and status, for the company only", async () => {
    check(
      await serviceRole().rpc('sync_whatsapp_message_templates', {
        p_company_id: world().companies.a.id,
        p_business_account_id: ACCOUNT_ID,
        p_templates: [
          { id: `${unique}91`, name: 'it_monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED' },
          { id: `${unique}92`, name: 'it_payment_reminder', language: 'en', category: 'UTILITY', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
        ],
      }),
      'Sync templates',
    )
    const templates = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(templates.filter((t) => t.businessAccountId === ACCOUNT_ID).map((t) => [t.name, t.language, t.category, t.status, t.rejectedReason])).toEqual([
      ['it_monthly_statement', 'en_ZA', 'UTILITY', 'APPROVED', undefined],
      ['it_payment_reminder', 'en', 'UTILITY', 'REJECTED', 'INVALID_FORMAT'],
    ])
    const other = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(other.some((t) => t.businessAccountId === ACCOUNT_ID)).toBe(false)
  })

  it('disconnects a number for company admins only, deleting its stored token', async () => {
    const disconnect = (user: 'admin' | 'manager') =>
      unwrap(apiAs(user, 'a').POST('/api/v1/integrations/whatsapp/numbers/{numberId}/disconnect', { params: { path: { numberId } } }))
    expect((await apiErrorOf(disconnect('manager'))).status).toBe(403)

    const result = await disconnect('admin')
    expect(result).toMatchObject({ numberId, status: 'disconnected', tokenRemoved: true })
    expect(await localSql(`select id from vault.secrets where id = '${secretId}'`)).toEqual([])
    expect(await listedNumber()).toMatchObject({ connectionStatus: 'disconnected', webhookConfigured: false, verificationSteps: [] })

    expect((await apiErrorOf(verify('admin'))).status).toBe(409)
    expect((await apiErrorOf(register(PIN))).status).toBe(409)
  })
})
