import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiEnvironment, freePort, startApi, type ApiBuild, type RunningApi } from '../fixtures/api-server.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { RedisConnection } from '../fixtures/redis.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Inbound WhatsApp routing (ticket 05) against the real API, database and Redis. A second API process of this run's
 * build is configured with a test app secret and verify token (never Meta's): it answers Meta's handshake, rejects
 * unsigned and tampered requests, and queues a signed payload once per body. The worker's routing step runs through
 * the same service-role function the worker calls (record_whatsapp_inbound_message); the worker's parsing is
 * unit-tested (backend/src/workers/whatsapp). Members then read only their own company's inbox through the API.
 */

const APP_SECRET = 'it-webhook-app-secret-not-a-real-one'
const VERIFY_TOKEN = 'it-webhook-verify-token'
const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const PHONE_A = `${unique}1`
const PHONE_B = `${unique}2`
const ACCOUNT_A = `${unique}3`
const ACCOUNT_B = `${unique}4`
const SENDER = `2784${unique.slice(-7)}`

const BUILD: ApiBuild = { dirName: '.dev-integration', logFile: path.join(TEST_OUTPUT_ROOT, 'integration', 'api-webhook.log') }

let api: RunningApi
let redis: RedisConnection
const numberIds: Record<'a' | 'b', string> = { a: '', b: '' }

const sign = (body: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function postWebhook(body: string, signature?: string, base = api.baseUrl) {
  return fetch(`${base}/api/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Hub-Signature-256': signature } : {}) },
    body,
  })
}

function handshake(token: string, base = api.baseUrl) {
  const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' })
  return fetch(`${base}/api/v1/webhooks/whatsapp?${query}`)
}

/** A payload as Meta sends it: one text message from SENDER to a receiving number. */
function messagePayload(phoneNumberId: string, messageId: string, text: string) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: ACCOUNT_A,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '27115550100', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: SENDER, profile: { name: 'Integration Sender' } }],
              messages: [{ id: messageId, from: SENDER, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  })
}

const jobPrefix = () => `${integration().queuePrefix}:whatsapp-webhook`

/** What the worker does for one message, through the same service-role function. */
async function route(company: 'a' | 'b', messageId: string, sender: { waId?: string; userId?: string }, body: string) {
  const rows = check(
    await serviceRole().rpc('record_whatsapp_inbound_message', {
      p_company_id: world().companies[company].id,
      p_number_id: numberIds[company],
      p_provider_message_id: messageId,
      p_user_id: sender.userId ?? null,
      p_wa_id: sender.waId ?? null,
      p_profile_name: 'Integration Sender',
      p_body: body,
      p_sent_at: new Date().toISOString(),
    }),
    'Route an inbound message',
  ) as { outcome: string; conversation_id: string | null }[]
  return rows[0]!
}

beforeAll(async () => {
  redis = await RedisConnection.open(integration().redisUrl)
  const db = serviceRole()
  for (const [key, phone, account] of [['a', PHONE_A, ACCOUNT_A], ['b', PHONE_B, ACCOUNT_B]] as const) {
    const companyId = world().companies[key].id
    expectOk(await db.from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: account }), 'Insert the account')
    const number = check(
      await db
        .from('whatsapp_phone_numbers')
        .insert({
          company_id: companyId,
          business_account_id: account,
          phone_number_id: phone,
          display_name: `Company ${key.toUpperCase()}`,
          display_number: key === 'a' ? '+27 11 555 0101' : '+27 12 555 0202',
          connection_status: 'connected',
        })
        .select('id')
        .single(),
      'Insert the connected number',
    ) as { id: string }
    numberIds[key] = number.id
  }

  const ctx = integration()
  api = await startApi(
    BUILD,
    apiEnvironment(BUILD, {
      API_PORT: String(await freePort()),
      SUPABASE_URL: ctx.supabaseUrl,
      SUPABASE_ANON_KEY: ctx.anonKey,
      REDIS_URL: ctx.redisUrl,
      QUEUE_PREFIX: ctx.queuePrefix,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    }),
  )
}, 90_000)

afterAll(async () => {
  await api?.stop()
  redis?.close()
  const db = serviceRole()
  const companyIds = [world().companies.a.id, world().companies.b.id]
  const ids = Object.values(numberIds).filter(Boolean)
  const conversations = ((await db.from('whatsapp_conversations').select('id').in('number_id', ids)).data ?? []) as { id: string }[]
  const conversationIds = conversations.map((c) => c.id)
  if (conversationIds.length > 0) {
    expectOk(await db.from('communications').delete().in('conversation_id', conversationIds), 'Delete the routed messages')
    expectOk(await db.from('whatsapp_conversations').delete().in('id', conversationIds), 'Delete the conversations')
  }
  expectOk(await db.from('whatsapp_contacts').delete().in('company_id', companyIds), 'Delete the contacts')
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', [PHONE_A, PHONE_B]), 'Delete the numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', [ACCOUNT_A, ACCOUNT_B]), 'Delete the accounts')
})

describe('WhatsApp webhook', () => {
  it("answers Meta's handshake with the right verify token only", async () => {
    const ok = await handshake(VERIFY_TOKEN)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('1158201444')
    expect((await handshake('wrong-token')).status).toBe(403)
    // The suite's own API has no verify token: the webhook says it is not configured.
    expect((await handshake(VERIFY_TOKEN, integration().apiBaseUrl)).status).toBe(503)
  })

  it('never writes the verify token to the API log', async () => {
    expect((await handshake(VERIFY_TOKEN)).status).toBe(200)
    // pino writes asynchronously; wait until the handshake's request line is in the log.
    let log = ''
    for (let attempt = 0; attempt < 50 && !log.includes('hub.verify_token=[Redacted]'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      log = readFileSync(BUILD.logFile, 'utf8')
    }
    expect(log).toContain('hub.verify_token=[Redacted]')
    expect(log).not.toContain(VERIFY_TOKEN)
  })

  it('rejects unsigned, tampered and wrongly signed requests, and queues nothing for them', async () => {
    const body = messagePayload(PHONE_A, `wamid.it-rejected-${unique}`, 'Hello')
    expect((await postWebhook(body)).status).toBe(401)
    expect((await postWebhook(body.replace('Hello', 'Hullo'), sign(body))).status).toBe(401)
    expect((await postWebhook(body, sign(body, 'another-secret'))).status).toBe(401)
    const waiting = (await redis.command('LRANGE', `${jobPrefix()}:wait`, '0', '-1')) as string[]
    expect(waiting.filter((id) => id.includes('whatsapp-webhook'))).toEqual([])
  })

  it('queues a signed payload once, however often Meta delivers it', async () => {
    const body = messagePayload(PHONE_A, `wamid.it-queued-${unique}`, 'Is parking available?')
    const first = await postWebhook(body, sign(body))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true, queued: true })
    expect((await postWebhook(body, sign(body))).status).toBe(200)

    const sha = createHash('sha256').update(body).digest('hex')
    const jobId = `whatsapp-webhook.${sha}`
    const data = JSON.parse(String(await redis.command('HGET', `${jobPrefix()}:${jobId}`, 'data'))) as { payloadSha256: string; body: string }
    expect(data.payloadSha256).toBe(sha)
    expect(data.body).toBe(body)
    const waiting = (await redis.command('LRANGE', `${jobPrefix()}:wait`, '0', '-1')) as string[]
    expect(waiting.filter((id) => id === jobId)).toHaveLength(1)
  })

  it('revives the failed job of a body when Meta delivers it again', async () => {
    const body = messagePayload(PHONE_A, `wamid.it-redelivered-${unique}`, 'Still there?')
    expect((await postWebhook(body, sign(body))).status).toBe(200)
    const jobId = `whatsapp-webhook.${createHash('sha256').update(body).digest('hex')}`

    // The worker used every attempt (e.g. a long database outage): BullMQ keeps the job as failed for 30 days.
    await redis.command('LREM', `${jobPrefix()}:wait`, '0', jobId)
    await redis.command('ZADD', `${jobPrefix()}:failed`, String(Date.now()), jobId)
    await redis.command('HSET', `${jobPrefix()}:${jobId}`, 'failedReason', 'database unavailable', 'finishedOn', String(Date.now()), 'atm', '5')

    // Meta's redelivery of the same body must queue it again, not be swallowed by the kept job id.
    expect((await postWebhook(body, sign(body))).status).toBe(200)
    expect(await redis.command('ZSCORE', `${jobPrefix()}:failed`, jobId)).toBeNull()
    const waiting = (await redis.command('LRANGE', `${jobPrefix()}:wait`, '0', '-1')) as string[]
    expect(waiting.filter((id) => id === jobId)).toHaveLength(1)
    expect(await redis.command('HGET', `${jobPrefix()}:${jobId}`, 'atm')).toBeNull()
  })

  it('refuses a body over 3 MB', async () => {
    const huge = JSON.stringify({ object: 'whatsapp_business_account', padding: 'x'.repeat(3 * 1024 * 1024) })
    expect((await postWebhook(huge, sign(huge))).status).toBe(413)
  })
})

describe('Inbound routing and the inbox', () => {
  it("lands each company's message only in that company's inbox, even from the same sender", async () => {
    expect(await route('a', `wamid.it-a-${unique}`, { waId: SENDER }, 'Hello A')).toMatchObject({ outcome: 'recorded' })
    expect(await route('b', `wamid.it-b-${unique}`, { waId: SENDER }, 'Hello B')).toMatchObject({ outcome: 'recorded' })

    const inboxA = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations'))
    const inboxB = await unwrap(apiAs('manager', 'b').GET('/api/v1/whatsapp/conversations'))
    const fromSender = (page: typeof inboxA) => page.items.filter((c) => c.contact.phoneNumber === `+${SENDER}`)
    expect(fromSender(inboxA)).toHaveLength(1)
    expect(fromSender(inboxA)[0]).toMatchObject({ numberId: numberIds.a, companyNumber: '+27 11 555 0101', lastMessagePreview: 'Hello A' })
    expect(fromSender(inboxB)).toHaveLength(1)
    expect(fromSender(inboxB)[0]).toMatchObject({ numberId: numberIds.b, lastMessagePreview: 'Hello B' })
    expect(JSON.stringify(inboxA)).not.toContain('Hello B')
    expect(JSON.stringify(inboxB)).not.toContain('Hello A')

    const threadA = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: fromSender(inboxA)[0]!.id } } }),
    )
    expect(threadA.messages.map((m) => [m.direction, m.status, m.recipientType, m.body])).toEqual([['inbound', 'received', 'contact', 'Hello A']])

    // Another company's conversation is not found, and a member of A only cannot open B's inbox.
    const otherCompany = apiAs('manager', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', {
      params: { path: { conversationId: fromSender(inboxB)[0]!.id } },
    })
    expect((await apiErrorOf(unwrap(otherCompany))).status).toBe(404)
    expect((await apiErrorOf(unwrap(apiAs('readOnly', 'b').GET('/api/v1/whatsapp/conversations')))).status).toBe(403)
  })

  it('records a message delivered twice once', async () => {
    const id = `wamid.it-dup-${unique}`
    expect(await route('a', id, { waId: SENDER }, 'Twice')).toMatchObject({ outcome: 'recorded' })
    expect(await route('a', id, { waId: SENDER }, 'Twice')).toMatchObject({ outcome: 'duplicate' })
    const { count } = await serviceRole().from('communications').select('id', { count: 'exact', head: true }).eq('external_message_id', id)
    expect(count).toBe(1)
  })

  it('drops a message to a number that is not the company\'s connected number', async () => {
    const rows = check(
      await serviceRole().rpc('record_whatsapp_inbound_message', {
        p_company_id: world().companies.a.id,
        p_number_id: numberIds.b,
        p_provider_message_id: `wamid.it-wrong-${unique}`,
        p_user_id: null,
        p_wa_id: SENDER,
        p_profile_name: null,
        p_body: 'Hi',
        p_sent_at: new Date().toISOString(),
      }),
      'Route to a wrong number',
    ) as { outcome: string }[]
    expect(rows[0]?.outcome).toBe('unknown_number')
  })

  it('shows a sender identified only by a business-scoped user id, without a number', async () => {
    const userId = `ZA.it${unique}`
    expect(await route('a', `wamid.it-bsuid-${unique}`, { userId }, 'No number here')).toMatchObject({ outcome: 'recorded' })
    const inbox = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations'))
    const conversation = inbox.items.find((c) => c.lastMessagePreview === 'No number here')
    expect(conversation?.contact.phoneNumber).toBeUndefined()
    expect(conversation?.contact.profileName).toBe('Integration Sender')
  })

  it("links a sender to a tenant of the receiving company only", async () => {
    const tenant = world().companies.a.tenants[0]!
    const waId = tenant.whatsappNumber.replace('+', '')
    expect(await route('a', `wamid.it-tenant-a-${unique}`, { waId }, 'From a tenant')).toMatchObject({ outcome: 'recorded' })
    expect(await route('b', `wamid.it-tenant-b-${unique}`, { waId }, 'Same person to B')).toMatchObject({ outcome: 'recorded' })

    const inboxA = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations'))
    expect(inboxA.items.find((c) => c.contact.phoneNumber === tenant.whatsappNumber)?.contact).toMatchObject({ tenantId: tenant.id })
    const inboxB = await unwrap(apiAs('manager', 'b').GET('/api/v1/whatsapp/conversations'))
    expect(inboxB.items.find((c) => c.contact.phoneNumber === tenant.whatsappNumber)?.contact.tenantId).toBeUndefined()
  })
})
