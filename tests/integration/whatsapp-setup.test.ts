import { unwrap } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../backend/src/infrastructure/database/database.types.ts'
import { FakeWhatsAppChannels } from '../../backend/src/infrastructure/whatsapp/fake-whatsapp-channels.test-helpers.ts'
import { sendTestMessage } from '../../backend/src/workers/whatsapp/test-message.ts'
import { DatabaseTestMessageStore, recordTestMessageStatus } from '../../backend/src/workers/whatsapp/test-message-store.ts'
import { listKeysWithPrefix } from '../fixtures/redis.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, world } from './support/clients.ts'

/**
 * WhatsApp setup, test messages and activation (ticket 11) against the real API, database and Redis. Company A has a
 * connected number and an approved utility template (written as the worker's verification would). The steps come
 * from the database's verified facts; a test message is requested through the API, sent by the worker's code with a
 * fake channel (no Meta), and completes its step only once Meta's delivered status is recorded; activation is refused
 * until then. Company B never sees A's setup or test messages.
 */

type Db = SupabaseClient<Database>

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const ACCOUNT = `${unique}91`
const PHONE = `${unique}92`
const TEMPLATE_META_ID = `${unique}93`
const WAMID = `wamid.it-setup-${unique}`
const RECIPIENT = `+2784${unique.slice(-7)}`
let numberId = ''
let templateId = ''

let service: Db | undefined
function serviceDb(): Db {
  const ctx = integration()
  service ??= createClient<Database>(ctx.supabaseUrl, ctx.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return service
}

const stateOf = (setup: { steps: { step: string; state: string }[] }, step: string) => setup.steps.find((s) => s.step === step)?.state

beforeAll(async () => {
  const companyId = world().companies.a.id
  expectOk(await serviceDb().from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: ACCOUNT }), 'Insert the account')
  numberId = check(
    await serviceDb()
      .from('whatsapp_phone_numbers')
      .insert({
        company_id: companyId,
        business_account_id: ACCOUNT,
        phone_number_id: PHONE,
        display_name: 'Atlas Leasing',
        display_number: `+27 11 555 ${PHONE.slice(-4)}`,
        connection_status: 'connected',
        webhook_configured: true,
        last_verified_at: new Date().toISOString(),
        access_token_reference: `secret://env/WHATSAPP_ACCESS_TOKEN_${companyId.replaceAll('-', '')}`,
      })
      .select('id')
      .single(),
    'Insert the connected number',
  ).id
  templateId = check(
    await serviceDb()
      .from('whatsapp_message_templates')
      .insert({ company_id: companyId, business_account_id: ACCOUNT, meta_template_id: TEMPLATE_META_ID, name: 'hello_world', language: 'en_US', category: 'UTILITY', status: 'APPROVED' })
      .select('id')
      .single(),
    'Insert the approved template',
  ).id
})

afterAll(async () => {
  const db = serviceDb()
  expectOk(await db.from('companies').update({ whatsapp_activated_at: null, whatsapp_activated_by_user_id: null }).eq('id', world().companies.a.id), 'Deactivate')
  expectOk(await db.from('whatsapp_test_messages').delete().eq('company_id', world().companies.a.id), 'Delete test messages')
  expectOk(await db.from('whatsapp_message_templates').delete().eq('meta_template_id', TEMPLATE_META_ID), 'Delete the template')
  expectOk(await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', PHONE), 'Delete the number')
  expectOk(await db.from('whatsapp_business_accounts').delete().eq('business_account_id', ACCOUNT), 'Delete the account')
})

describe('WhatsApp setup', () => {
  it('reports the ten steps from verified facts to every member, and refuses activation before the test message', async () => {
    const setup = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/setup'))
    expect(setup.steps.map((s) => s.step)).toEqual([
      'business_profile', 'meta_account', 'business_account', 'phone_number', 'webhook',
      'message_templates', 'ai_agent', 'knowledge_base', 'test_message', 'ready_for_activation',
    ])
    expect(setup.steps.slice(0, 6).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    expect(stateOf(setup, 'test_message')).toBe('action_needed')
    expect(stateOf(setup, 'ready_for_activation')).toBe('blocked')
    expect(setup).toMatchObject({ readyForActivation: false, activation: { active: false } })
    expect(setup.latestTestMessage).toBeUndefined()

    const refused = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/activation')))
    expect(refused.status).toBe(409)
  })

  it("is the active company's only: company B's setup is its own, and A's admin cannot read B's", async () => {
    const b = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/setup'))
    expect(stateOf(b, 'phone_number')).not.toBe('done')
    expect((await apiErrorOf(unwrap(apiAs('admin', world().companies.b.id).GET('/api/v1/integrations/whatsapp/setup')))).status).toBe(403)
  })
})

describe('Test message', () => {
  const body = () => ({ numberId, templateId, to: RECIPIENT })

  it('is for company admins only, and never to a tenant', async () => {
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/integrations/whatsapp/test-messages', { body: body() })))).status).toBe(403)
    const tenant = world().companies.a.tenants[0]!.whatsappNumber
    const refused = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/test-messages', { body: { ...body(), to: tenant } })))
    expect(refused.status).toBe(422)
    expect(refused.messages.join(' ')).toMatch(/tenant/i)
    expect((await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/test-messages', { body: { ...body(), to: '0821234567' } })))).status).toBe(400)
  })

  it('completes its step only when Meta reports it delivered, after which an admin can activate', async () => {
    const queued = await unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/test-messages', { body: body() }))
    expect(queued).toMatchObject({ status: 'queued', toNumber: RECIPIENT, templateName: 'hello_world', templateLanguage: 'en_US' })
    const companyId = world().companies.a.id
    const jobKey = `${integration().queuePrefix}:whatsapp-test-message:whatsapp-test-message.${companyId.toLowerCase()}.${queued.id.toLowerCase()}`
    expect(await listKeysWithPrefix(integration().redisUrl, integration().queuePrefix)).toContain(jobKey)

    let setup = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/setup'))
    expect(stateOf(setup, 'test_message')).toBe('waiting_on_meta')
    expect(setup.latestTestMessage).toMatchObject({ id: queued.id, status: 'queued' })

    // The worker's job, with a fake channel instead of Meta.
    const channels = new FakeWhatsAppChannels({ send: async () => ({ messageId: WAMID }) })
    const job = { companyId, testMessageId: queued.id }
    expect(await sendTestMessage({ store: new DatabaseTestMessageStore(serviceDb()), channels }, job, { finalAttempt: false })).toEqual({ outcome: 'sent', providerMessageId: WAMID })
    expect(channels.sends).toEqual([
      { companyId, to: RECIPIENT, message: { type: 'template', template: { name: 'hello_world', language: { code: 'en_US' }, components: [] } } },
    ])
    expect(channels.lookups).toEqual([{ companyId, options: { phoneNumberId: PHONE } }])
    // A repeated job never sends again.
    expect(await sendTestMessage({ store: new DatabaseTestMessageStore(serviceDb()), channels }, job, { finalAttempt: false })).toEqual({ outcome: 'skipped' })
    expect(channels.sends).toHaveLength(1)

    const status = (s: 'sent' | 'delivered') =>
      recordTestMessageStatus(serviceDb(), { companyId, providerMessageId: WAMID, status: s, occurredAt: new Date().toISOString() })
    expect(await recordTestMessageStatus(serviceDb(), { companyId: world().companies.b.id, providerMessageId: WAMID, status: 'delivered', occurredAt: new Date().toISOString() })).toBe('not_found')
    expect(await status('sent')).toBe('unchanged')
    setup = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/setup'))
    expect(stateOf(setup, 'test_message')).toBe('waiting_on_meta')
    expect((await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/activation')))).status).toBe(409)

    expect(await status('delivered')).toBe('advanced')
    setup = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/setup'))
    expect(stateOf(setup, 'test_message')).toBe('done')
    expect(setup.readyForActivation).toBe(true)

    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/integrations/whatsapp/activation')))).status).toBe(403)
    const activation = await unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/activation'))
    expect(activation).toMatchObject({ active: true, activatedAt: expect.any(String), activatedByUserId: world().users.admin.id })
    const seen = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/setup'))
    expect(seen.activation.active).toBe(true)
    expect(seen.latestTestMessage).toBeUndefined()

    expect(await unwrap(apiAs('admin', 'a').DELETE('/api/v1/integrations/whatsapp/activation'))).toEqual({ active: false })
  })

  it('stays invisible to other companies through the Data API', async () => {
    const ctx = integration()
    const manager = createClient<Database>(ctx.supabaseUrl, ctx.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${ctx.accessTokens.manager}` } },
    })
    const { data, error } = await manager.from('whatsapp_test_messages').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
