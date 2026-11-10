import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { ServiceRoleClientFactory } from '../database/service-role-client.factory'
import { createWhatsAppChannels } from './database-whatsapp-channels'
import type { FetchFn } from './whatsapp.client'
import {
  type ChannelLookup,
  ChannelLookupError,
  type ReceivingNumberOwner,
  WhatsAppApiError,
  type WhatsAppChannel,
} from './whatsapp-channels'

/**
 * The channel module through its interface: the account row and the vault RPC come from a fake
 * database, Graph from a fake fetch. The SQL side (reference CHECK, vault lookup, one company per
 * number) is tested against local Postgres in supabase/tests/whatsapp_channel.test.sql.
 */

const NEXUS = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const KGALAGADI = '3a232d9e-45a2-54dc-85cd-d2435fb1fc10'
const NEXUS_VARIABLE = 'WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E'
const KGALAGADI_VARIABLE = 'WHATSAPP_ACCESS_TOKEN_3A232D9E45A254DC85CDD2435FB1FC10'
const ACCOUNT = 'acc00000-0000-4000-8000-000000000001'
const VAULT_SECRET = '3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13'
const SECRETS = {
  [NEXUS_VARIABLE]: ' nexus-token ',
  [KGALAGADI_VARIABLE]: 'kgalagadi-token',
  WHATSAPP_ACCESS_TOKEN: 'shared-token',
  WHATSAPP_ACCESS_TOKEN_NEXUS: 'named-token',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}
const ALL_TOKENS = /nexus-token|kgalagadi-token|shared-token|named-token|service-role-key|vault-token/

const accountRow = {
  id: ACCOUNT,
  company_id: NEXUS,
  phone_number_id: '1234567890',
  access_token_reference: `secret://env/${NEXUS_VARIABLE}`,
  connection_status: 'connected',
}

interface Options {
  account?: Partial<typeof accountRow> | null
  /** Every number of the company, in place of `account`. */
  numbers?: Partial<typeof accountRow & { created_at: string }>[]
  accountResult?: FakeResult
  rpc?: FakeResult
  graph?: () => Promise<Response>
  app?: { appId: string; appSecret: string } | null
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function harness(options: Options = {}) {
  const rows = options.numbers?.map((number) => ({ ...accountRow, ...number })) ?? (options.account === null ? [] : [{ ...accountRow, ...options.account }])
  // A lookup by receiving number reads one row (maybeSingle); a company lookup reads all its numbers.
  const db = fakeDb(
    (query) =>
      options.accountResult ??
      (query.calls.some(([method]) => method === 'maybeSingle') ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }),
  )
  const rpc = vi.fn(async () => options.rpc ?? { data: 'vault-token', error: null })
  const clients = { get: () => ({ ...(db.client as object), rpc }) } as unknown as ServiceRoleClientFactory
  const graphCalls: { url: string; init: RequestInit }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    graphCalls.push({ url, init })
    return (options.graph ?? (async () => jsonResponse(200, { messages: [{ id: 'wamid.OK' }], id: 'media-1' })))()
  }
  const channels = createWhatsAppChannels(
    clients,
    { apiUrl: 'https://graph.facebook.com', apiVersion: 'v23.0', fetch: fetchFn },
    SECRETS,
    options.app === undefined ? { appId: '424242', appSecret: 'app-secret' } : options.app,
  )
  return { channels, queries: db.queries, rpc, graphCalls }
}

const text = { type: 'text' as const, text: { body: 'Hello', preview_url: false as const } }
const eqCalls = (query: RecordedQuery | undefined) => (query ? callsTo(query, 'eq') : [])
const bearer = (call: { init: RequestInit } | undefined) => (call?.init.headers as Record<string, string> | undefined)?.Authorization

function owned(owner: ReceivingNumberOwner | null): ReceivingNumberOwner {
  if (!owner) throw new Error('expected the receiving number to have an owner')
  return owner
}

function connected(lookup: ChannelLookup): WhatsAppChannel {
  if (!lookup.available) throw new Error(`expected a channel, got ${lookup.reason}: ${lookup.message}`)
  return lookup
}

describe('WhatsAppChannels.forCompany', () => {
  it("sends and uploads from the company's number with the company's own env token, never exposing it", async () => {
    const { channels, queries, graphCalls } = harness()
    const lookup = await channels.forCompany(NEXUS)
    expect(JSON.stringify(lookup)).not.toMatch(ALL_TOKENS)

    const channel = connected(lookup)
    await expect(channel.send('+27 82 123 4567', text)).resolves.toEqual({ messageId: 'wamid.OK' })
    await expect(channel.uploadMedia(new Blob(['%PDF']), 'oct.pdf', 'application/pdf')).resolves.toEqual({ mediaId: 'media-1' })

    expect(graphCalls.map((call) => call.url)).toEqual([
      'https://graph.facebook.com/v23.0/1234567890/messages',
      'https://graph.facebook.com/v23.0/1234567890/media',
    ])
    expect(graphCalls.map(bearer)).toEqual(['Bearer nexus-token', 'Bearer nexus-token'])
    expect(queries).toHaveLength(1)
    expect(queries[0]?.table).toBe('whatsapp_phone_numbers')
    expect(eqCalls(queries[0])).toEqual([['company_id', NEXUS]])
  })

  it('looks up a specific receiving number of the company when one is named', async () => {
    const { channels, queries } = harness()
    connected(await channels.forCompany(NEXUS, { phoneNumberId: '1234567890' }))
    expect(eqCalls(queries[0])).toEqual([
      ['company_id', NEXUS],
      ['phone_number_id', '1234567890'],
    ])
  })

  it("sends from the company's earliest connected number when it has several and none is named", async () => {
    const { channels, graphCalls } = harness({
      numbers: [
        { id: 'n-new', phone_number_id: '333', connection_status: 'connected', created_at: '2026-11-03T08:00:00Z' },
        { id: 'n-pending', phone_number_id: '111', connection_status: 'pending_verification', created_at: '2026-11-01T08:00:00Z' },
        { id: 'n-old', phone_number_id: '222', connection_status: 'connected', created_at: '2026-11-02T08:00:00Z' },
      ],
    })
    await connected(await channels.forCompany(NEXUS)).send('+27821234567', text)
    expect(graphCalls[0]?.url).toBe('https://graph.facebook.com/v23.0/222/messages')
  })

  it("reports the earliest number's status when none of several numbers is connected", async () => {
    const { channels } = harness({
      numbers: [
        { phone_number_id: '222', connection_status: 'disconnected', created_at: '2026-11-02T08:00:00Z' },
        { phone_number_id: '111', connection_status: 'pending_verification', created_at: '2026-11-01T08:00:00Z' },
      ],
    })
    await expect(channels.forCompany(NEXUS)).resolves.toMatchObject({ reason: 'not_connected', message: 'The company WhatsApp account is pending verification' })
  })

  it('is unavailable, with a reason, when the company has no account or it is not connected', async () => {
    await expect(harness({ account: null }).channels.forCompany(NEXUS)).resolves.toEqual({
      available: false,
      reason: 'not_configured',
      message: 'The company has no WhatsApp Business account configured',
    })
    await expect(harness({ account: null }).channels.forCompany(NEXUS, { phoneNumberId: '99' })).resolves.toMatchObject({
      reason: 'not_configured',
      message: 'The company has no WhatsApp Business account for that phone number',
    })
    const pending = harness({ account: { connection_status: 'pending_verification' } })
    await expect(pending.channels.forCompany(NEXUS)).resolves.toEqual({
      available: false,
      reason: 'not_connected',
      message: 'The company WhatsApp account is pending verification',
    })
    expect(pending.graphCalls).toEqual([])
  })

  it("refuses any env reference but the company's own variable, without echoing a secret", async () => {
    for (const reference of [
      `secret://env/${KGALAGADI_VARIABLE}`,
      'secret://env/WHATSAPP_ACCESS_TOKEN',
      'secret://env/WHATSAPP_ACCESS_TOKEN_NEXUS',
      `secret://env/${NEXUS_VARIABLE.toLowerCase()}`,
      'secret://env/SUPABASE_SERVICE_ROLE_KEY',
      'secret://whatsapp/cmp_nexus/access-token',
    ]) {
      const { channels, rpc } = harness({ account: { access_token_reference: reference } })
      const lookup = await channels.forCompany(NEXUS)
      expect(lookup).toEqual({ available: false, reason: 'credentials_unavailable', message: 'The WhatsApp access token reference is not supported' })
      expect(rpc).not.toHaveBeenCalled()
    }
    // The row says Kgalagadi's reference is Nexus's variable: still refused, the binding is by row company.
    const crossed = harness({ account: { company_id: KGALAGADI } })
    await expect(crossed.channels.forCompany(KGALAGADI)).resolves.toMatchObject({ reason: 'credentials_unavailable' })
  })

  it("is unavailable when the company's variable is not set in the worker", async () => {
    const { channels } = harness({ account: { company_id: '00000000-0000-4000-8000-000000000009', access_token_reference: 'secret://env/WHATSAPP_ACCESS_TOKEN_00000000000040008000000000000009' } })
    await expect(channels.forCompany('00000000-0000-4000-8000-000000000009')).resolves.toEqual({
      available: false,
      reason: 'credentials_unavailable',
      message: 'The WhatsApp access token variable WHATSAPP_ACCESS_TOKEN_00000000000040008000000000000009 is not set in the worker environment',
    })
  })

  it('reads a vault reference through the service-role function by account id, never by secret id', async () => {
    const { channels, rpc, graphCalls } = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` } })
    const channel = connected(await channels.forCompany(NEXUS))
    await channel.send('+27821234567', text)
    expect(rpc).toHaveBeenCalledWith('whatsapp_account_access_token', { p_account_id: ACCOUNT })
    expect(bearer(graphCalls[0])).toBe('Bearer vault-token')
  })

  it('is unavailable when the vault refuses the reference (missing or another company\'s secret)', async () => {
    const { channels } = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` }, rpc: { data: null, error: null } })
    await expect(channels.forCompany(NEXUS)).resolves.toEqual({
      available: false,
      reason: 'credentials_unavailable',
      message: "The WhatsApp access token is not in the vault for this company's account",
    })
  })

  it('throws a retryable ChannelLookupError when the account or the vault cannot be read', async () => {
    const down = { data: null, error: { code: 'PGRST000', message: 'connection refused' } }
    await expect(harness({ accountResult: down }).channels.forCompany(NEXUS)).rejects.toBeInstanceOf(ChannelLookupError)
    const vaultDown = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` }, rpc: down })
    await expect(vaultDown.channels.forCompany(NEXUS)).rejects.toThrow('Load the WhatsApp access token from the vault failed (PGRST000)')
  })

  it('keeps the Graph error classification: throttling is retryable, other refusals are not, nothing leaks the token', async () => {
    const throttled = harness({ graph: async () => jsonResponse(400, { error: { message: 'Rate limit hit', code: 130429 } }) })
    const throttledError = await connected(await throttled.channels.forCompany(NEXUS))
      .send('+27821234567', text)
      .catch((error: unknown) => error)
    expect(throttledError).toBeInstanceOf(WhatsAppApiError)
    expect(throttledError).toMatchObject({ retryable: true, graphCode: 130429, outcomeUnknown: false })

    const refused = harness({ graph: async () => jsonResponse(401, { error: { message: 'Expired', code: 190 } }) })
    const refusedError = await connected(await refused.channels.forCompany(NEXUS))
      .send('+27821234567', text)
      .catch((error: unknown) => error)
    expect(refusedError).toMatchObject({ retryable: false, status: 401 })
    expect(String(refusedError)).not.toMatch(ALL_TOKENS)
  })
})

describe('WhatsAppChannels.forReceivingNumber', () => {
  it('names the connected owner without resolving its credential, and opens the channel on demand', async () => {
    const { channels, queries, rpc, graphCalls } = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` } })
    const owner = owned(await channels.forReceivingNumber('1234567890'))
    expect(owner.companyId).toBe(NEXUS)
    expect(owner.numberId).toBe(ACCOUNT)
    expect(eqCalls(queries[0])).toEqual([
      ['phone_number_id', '1234567890'],
      ['connection_status', 'connected'],
    ])
    expect(rpc).not.toHaveBeenCalled()

    const channel = connected(await owner.channel())
    await channel.send('+27821234567', text)
    expect(rpc).toHaveBeenCalledWith('whatsapp_account_access_token', { p_account_id: ACCOUNT })
    expect(bearer(graphCalls[0])).toBe('Bearer vault-token')
  })

  it('still routes to the owner when the vault is unreachable; only opening the channel fails', async () => {
    const down = { data: null, error: { code: 'PGRST000', message: 'connection refused' } }
    const { channels } = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` }, rpc: down })
    const owner = await channels.forReceivingNumber('1234567890')
    expect(owner?.companyId).toBe(NEXUS)
    await expect(owned(owner).channel()).rejects.toBeInstanceOf(ChannelLookupError)
  })

  it('never names an unverified account as the owner (an admin can type any number)', async () => {
    for (const status of ['pending_verification', 'disconnected', 'error', 'not_configured']) {
      await expect(harness({ account: { connection_status: status } }).channels.forReceivingNumber('1234567890')).resolves.toBeNull()
    }
    await expect(harness({ account: null }).channels.forReceivingNumber('555')).resolves.toBeNull()
  })

  it('opens an unavailable channel with its reason when the owner has no usable credential', async () => {
    const { channels } = harness({ account: { access_token_reference: `secret://vault/${VAULT_SECRET}` }, rpc: { data: null, error: null } })
    const owner = await channels.forReceivingNumber('1234567890')
    await expect(owned(owner).channel()).resolves.toMatchObject({ available: false, reason: 'credentials_unavailable' })
  })
})

describe('WhatsAppChannels.manageNumber (verification)', () => {
  const pending = { connection_status: 'pending_verification', business_account_id: '771001', access_token_reference: `secret://vault/${VAULT_SECRET}` }

  it("manages a pending number of the company with its vault token, never exposing the token", async () => {
    const { channels, queries, rpc, graphCalls } = harness({
      account: pending,
      graph: async () => jsonResponse(200, { success: true, data: { is_valid: true } }),
    })
    const lookup = await channels.manageNumber(NEXUS, ACCOUNT)
    expect(JSON.stringify(lookup)).not.toMatch(ALL_TOKENS)
    if (!lookup.available) throw new Error(lookup.message)
    expect(lookup).toMatchObject({ businessAccountId: '771001', phoneNumberId: '1234567890' })
    await lookup.subscribeApp()
    await lookup.inspectToken()
    expect(eqCalls(queries[0])).toEqual([
      ['company_id', NEXUS],
      ['id', ACCOUNT],
    ])
    expect(rpc).toHaveBeenCalledWith('whatsapp_account_access_token', { p_account_id: ACCOUNT })
    expect(graphCalls.map((call) => [call.url.split('?')[0], bearer(call)])).toEqual([
      ['https://graph.facebook.com/v23.0/771001/subscribed_apps', 'Bearer vault-token'],
      ['https://graph.facebook.com/v23.0/debug_token', 'Bearer 424242|app-secret'],
    ])
  })

  it('cannot inspect the token without the Meta app credentials', async () => {
    const { channels, graphCalls } = harness({ account: pending, app: null })
    const lookup = await channels.manageNumber(NEXUS, ACCOUNT)
    if (!lookup.available) throw new Error(lookup.message)
    await expect(lookup.inspectToken()).resolves.toBeNull()
    expect(graphCalls).toEqual([])
  })

  it('refuses a number that is not the company\'s, a disconnected one, and an unresolvable credential', async () => {
    await expect(harness({ account: null }).channels.manageNumber(NEXUS, ACCOUNT)).resolves.toMatchObject({ available: false, reason: 'not_configured' })
    await expect(harness({ account: { ...pending, connection_status: 'disconnected' } }).channels.manageNumber(NEXUS, ACCOUNT)).resolves.toMatchObject({
      available: false,
      reason: 'not_connected',
    })
    await expect(harness({ account: pending, rpc: { data: null, error: null } }).channels.manageNumber(NEXUS, ACCOUNT)).resolves.toMatchObject({
      available: false,
      reason: 'credentials_unavailable',
    })
  })
})
