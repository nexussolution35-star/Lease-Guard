import { unwrap } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../backend/src/infrastructure/database/database.types.ts'
import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, world } from './support/clients.ts'

/**
 * Communication analytics (ticket 12) against the real API and database. Company A and company B each get WhatsApp
 * activity on 15 June 2021 (a day no other test touches), written as the worker would. Every member of A reads A's
 * figures for that day; B's member reads only B's; nobody reads another company's figures through the API or straight
 * through the Data API with their own token.
 */

type Db = SupabaseClient<Database>

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const ACCOUNT = `${unique}81`
const PHONE = `${unique}82`
const WA_ID = `2783${unique.slice(-7)}`
const DAY = '2021-06-15'
const at = (time: string) => `${DAY}T${time}+02:00`
const communicationIds: string[] = []
let contactId = ''

let service: Db | undefined
function serviceDb(): Db {
  const ctx = integration()
  service ??= createClient<Database>(ctx.supabaseUrl, ctx.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return service
}

function signedIn(user: 'readOnly' | 'manager'): Db {
  const ctx = integration()
  return createClient<Database>(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens[user]}` } },
  })
}

type CommunicationInsert = Database['public']['Tables']['communications']['Insert']

async function insertMessages(rows: CommunicationInsert[]): Promise<string[]> {
  const ids = check(await serviceDb().from('communications').insert(rows).select('id'), 'Insert messages').map((r) => r.id)
  communicationIds.push(...ids)
  return ids
}

/** Inserts already-dated messages in delivery states as the database owner (local stack only). */
async function insertDeliveredMessages(rows: CommunicationInsert[]): Promise<void> {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].join(', ')
  const json = JSON.stringify(rows).replaceAll("'", "''")
  const inserted = (await localSql(
    `insert into public.communications (${columns}) select ${columns} from jsonb_populate_recordset(null::public.communications, '${json}'::jsonb) returning id`,
  )) as { id: string }[]
  communicationIds.push(...inserted.map((row) => row.id))
}

beforeAll(async () => {
  const a = world().companies.a
  const b = world().companies.b
  const owner = world().users.owner
  const ownerMessage = (status: CommunicationInsert['status'], extra: Partial<CommunicationInsert>): CommunicationInsert => ({
    company_id: a.id,
    channel: 'whatsapp',
    direction: 'outbound',
    message_type: 'owner_weekly_summary',
    recipient_type: 'property_owner',
    owner_user_id: owner.id,
    counterparty_number: owner.whatsappNumber,
    company_number: '+27115550100',
    body: 'Weekly summary',
    status,
    created_at: at('10:00:00'),
    ...extra,
  })

  expectOk(await serviceDb().from('whatsapp_business_accounts').insert({ company_id: a.id, business_account_id: ACCOUNT }), 'Insert the account')
  const numberId = check(
    await serviceDb()
      .from('whatsapp_phone_numbers')
      .insert({
        company_id: a.id,
        business_account_id: ACCOUNT,
        phone_number_id: PHONE,
        display_name: 'Atlas Leasing',
        display_number: `+27 11 555 ${PHONE.slice(-4)}`,
        access_token_reference: `secret://env/WHATSAPP_ACCESS_TOKEN_${a.id.replaceAll('-', '')}`,
      })
      .select('id')
      .single(),
    'Insert the number',
  ).id
  contactId = check(
    await serviceDb().from('whatsapp_contacts').insert({ company_id: a.id, wa_id: WA_ID, first_message_at: at('09:00:00'), last_message_at: at('09:00:00') }).select('id').single(),
    'Insert the contact',
  ).id
  const conversationId = check(
    await serviceDb()
      .from('whatsapp_conversations')
      .insert({ company_id: a.id, number_id: numberId, contact_id: contactId, last_inbound_at: at('09:00:00'), last_message_at: at('09:00:00') })
      .select('id')
      .single(),
    'Insert the conversation',
  ).id

  // A: two inbound messages from a contact (one at the first minute of the day), a read, a delivered and a failed
  // owner message, one awaiting approval; and one sent the evening before.
  const inbound = (wamid: string, time: string): CommunicationInsert => ({
    company_id: a.id,
    channel: 'whatsapp',
    direction: 'inbound',
    message_type: 'inbound_reply',
    recipient_type: 'contact',
    contact_id: contactId,
    conversation_id: conversationId,
    counterparty_number: `+${WA_ID}`,
    company_number: '+27115550100',
    body: 'Hello',
    status: 'received',
    external_message_id: wamid,
    created_at: at(time),
  })
  const [first, second] = await insertMessages([inbound(`wamid.it-an-${unique}-1`, '00:00:30'), inbound(`wamid.it-an-${unique}-2`, '18:00:00')])
  // Delivery states are written by the lifecycle as the worker, never by a plain insert through the Data API; as the
  // database owner the test records them directly, already dated.
  await insertDeliveredMessages([
    ownerMessage('read', { external_message_id: `wamid.it-an-${unique}-3`, sent_at: at('10:00:00'), delivered_at: at('10:00:05'), read_at: at('10:01:00') }),
    ownerMessage('delivered', { external_message_id: `wamid.it-an-${unique}-4`, sent_at: at('10:00:00'), delivered_at: at('10:00:05') }),
    ownerMessage('failed', { external_message_id: `wamid.it-an-${unique}-5`, sent_at: at('10:00:00'), failure_reason: 'Test: undeliverable' }),
    ownerMessage('sent', { external_message_id: `wamid.it-an-${unique}-6`, sent_at: '2021-06-14T23:30:00+02:00', created_at: '2021-06-14T23:30:00+02:00' }),
  ])
  await insertMessages([ownerMessage('pending_approval', {})])
  // The agent answered the first message and handed the second to a person with a suggested reply.
  const handoverId = check(
    await serviceDb()
      .from('whatsapp_handovers')
      .insert({ company_id: a.id, conversation_id: conversationId, reason: 'Needs a person', requested_by: 'agent', created_at: at('18:00:05') })
      .select('id')
      .single(),
    'Insert the handover',
  ).id
  expectOk(
    await serviceDb().from('whatsapp_agent_runs').insert([
      { company_id: a.id, conversation_id: conversationId, communication_id: first!, status: 'completed', outcome: 'replied', category: 'faq', confidence: 0.9, completed_at: at('00:00:40'), created_at: at('00:00:30') },
      {
        company_id: a.id,
        conversation_id: conversationId,
        communication_id: second!,
        status: 'completed',
        outcome: 'handed_over',
        category: 'complaint',
        confidence: 0.8,
        suggested_reply: 'We are sorry to hear that.',
        handover_id: handoverId,
        completed_at: at('18:00:05'),
        created_at: at('18:00:00'),
      },
    ]),
    'Insert the agent runs',
  )

  // B: one inbound message from its tenant the same day.
  const tenant = b.tenants[0]!
  await insertMessages([
    {
      company_id: b.id,
      channel: 'whatsapp',
      direction: 'inbound',
      message_type: 'inbound_reply',
      recipient_type: 'tenant',
      tenant_id: tenant.id,
      counterparty_number: tenant.whatsappNumber,
      company_number: '+27125550200',
      body: 'Thanks',
      status: 'received',
      external_message_id: `wamid.it-an-${unique}-b1`,
      created_at: at('12:00:00'),
    },
  ])
})

afterAll(async () => {
  const db = serviceDb()
  if (communicationIds.length > 0) expectOk(await db.from('communications').delete().in('id', communicationIds), 'Delete messages')
  if (contactId) expectOk(await db.from('whatsapp_contacts').delete().eq('id', contactId), 'Delete the contact (and its conversation and handover)')
  expectOk(await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', PHONE), 'Delete the number')
  expectOk(await db.from('whatsapp_business_accounts').delete().eq('business_account_id', ACCOUNT), 'Delete the account')
})

describe('Communication analytics', () => {
  it("gives every member of A A's figures for the day", async () => {
    const figures = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: DAY, to: DAY } } }))
    expect(figures).toEqual({
      from: DAY,
      to: DAY,
      inbound: 2,
      outbound: 3,
      delivered: 2,
      read: 1,
      failed: 1,
      handovers: 1,
      agentHandovers: 1,
      agentReplies: 1,
      outOfHoursMessages: 0,
      suggestedReplies: 1,
    })
    const owner = await unwrap(apiAs('owner', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: DAY, to: DAY } } }))
    expect(owner.inbound).toBe(2)
  })

  it('takes in the evening before when the range starts a day earlier', async () => {
    const figures = await unwrap(apiAs('manager', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: '2021-06-14', to: DAY } } }))
    expect(figures.outbound).toBe(4)
  })

  it("gives B's member only B's figures, and nobody another company's", async () => {
    const b = await unwrap(apiAs('manager', 'b').GET('/api/v1/communications/analytics', { params: { query: { from: DAY, to: DAY } } }))
    expect(b).toMatchObject({ inbound: 1, outbound: 0, handovers: 0, agentReplies: 0, suggestedReplies: 0 })

    const refused = await apiErrorOf(
      unwrap(apiAs('readOnly', world().companies.b.id).GET('/api/v1/communications/analytics', { params: { query: { from: DAY, to: DAY } } })),
    )
    expect(refused.status).toBe(403)

    // Straight through the Data API with the member's own token: the database refuses too.
    const direct = await signedIn('readOnly').rpc('communication_analytics', { p_company_id: world().companies.b.id, p_from: DAY, p_to: DAY })
    expect(direct.error?.code).toBe('42501')
  })

  it('refuses a range that ends before it starts or is longer than 366 days, and anonymous callers', async () => {
    const reversed = await apiErrorOf(unwrap(apiAs('readOnly', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: DAY, to: '2021-06-14' } } })))
    expect(reversed.status).toBe(400)
    const long = await apiErrorOf(unwrap(apiAs('readOnly', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: '2020-01-01', to: '2021-01-01' } } })))
    expect(long.status).toBe(400)
    const malformed = await apiErrorOf(unwrap(apiAs('readOnly', 'a').GET('/api/v1/communications/analytics', { params: { query: { from: '15/06/2021' } } })))
    expect(malformed.status).toBe(400)
    expect((await apiErrorOf(unwrap(apiAs(null, 'a').GET('/api/v1/communications/analytics')))).status).toBe(401)
  })

  it('defaults to the last 30 days', async () => {
    const figures = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/communications/analytics'))
    const days = (Date.parse(figures.to) - Date.parse(figures.from)) / 86_400_000
    expect(days).toBe(29)
  })
})
