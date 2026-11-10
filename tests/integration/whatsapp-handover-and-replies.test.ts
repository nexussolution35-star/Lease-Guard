import { unwrap } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listKeysWithPrefix } from '../fixtures/redis.ts'
import type { WorldUserKey } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Handovers and replies to contacts (ticket 07) against the real API, database and Redis. Inbound messages are
 * recorded the way the worker records them (record_whatsapp_inbound_message, service role); everything else goes
 * through the API as the world's users: only company writers accept, assign and resolve handovers and reply; a
 * reply is approved by its author and queued for delivery; replies are refused outside the 24-hour customer service
 * window and never reach a tenant, also when a writer tries to write one directly with their own sign-in.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const PHONE = { a: `${unique}71`, b: `${unique}72` }
const ACCOUNT = { a: `${unique}73`, b: `${unique}74` }
const SENDER = `2785${unique.slice(-7)}`
const numberIds: Record<'a' | 'b', string> = { a: '', b: '' }
const conversations = { contactA: '', tenantA: '', contactB: '' }

async function route(company: 'a' | 'b', messageId: string, waId: string, body: string): Promise<string> {
  const rows = check(
    await serviceRole().rpc('record_whatsapp_inbound_message', {
      p_company_id: world().companies[company].id,
      p_number_id: numberIds[company],
      p_provider_message_id: messageId,
      p_user_id: null,
      p_wa_id: waId,
      p_profile_name: 'Handover Sender',
      p_body: body,
      p_sent_at: new Date().toISOString(),
    }),
    'Route an inbound message',
  ) as { outcome: string; conversation_id: string }[]
  expect(rows[0]?.outcome).toBe('recorded')
  return rows[0]!.conversation_id
}

/** A Supabase client signed in as a world user (Row Level Security and every guard apply). */
function signedIn(user: WorldUserKey): SupabaseClient {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens[user]}` } },
  })
}

const conversationPath = (conversationId: string) => ({ params: { path: { conversationId } } })

beforeAll(async () => {
  const db = serviceRole()
  for (const key of ['a', 'b'] as const) {
    const companyId = world().companies[key].id
    expectOk(await db.from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: ACCOUNT[key] }), 'Insert the account')
    const number = check(
      await db
        .from('whatsapp_phone_numbers')
        .insert({
          company_id: companyId,
          business_account_id: ACCOUNT[key],
          phone_number_id: PHONE[key],
          display_name: `Handover ${key.toUpperCase()}`,
          display_number: key === 'a' ? '+27 11 555 0171' : '+27 12 555 0272',
          connection_status: 'connected',
        })
        .select('id')
        .single(),
      'Insert the connected number',
    ) as { id: string }
    numberIds[key] = number.id
  }
  conversations.contactA = await route('a', `wamid.ho-a-${unique}`, SENDER, 'Do you have parking?')
  conversations.tenantA = await route('a', `wamid.ho-t-${unique}`, world().companies.a.tenants[0]!.whatsappNumber.replace('+', ''), 'About my statement')
  conversations.contactB = await route('b', `wamid.ho-b-${unique}`, SENDER, 'Hello B')
})

afterAll(async () => {
  const db = serviceRole()
  const ids = Object.values(conversations).filter(Boolean)
  if (ids.length > 0) {
    expectOk(await db.from('communications').delete().in('conversation_id', ids), 'Delete the messages')
    expectOk(await db.from('whatsapp_conversations').delete().in('id', ids), 'Delete the conversations and their handovers')
  }
  expectOk(await db.from('whatsapp_contacts').delete().in('company_id', [world().companies.a.id, world().companies.b.id]), 'Delete the contacts')
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', Object.values(PHONE)), 'Delete the numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', Object.values(ACCOUNT)), 'Delete the accounts')
})

describe('Handovers', () => {
  it('lets only writers take a conversation over, assign and resolve it', async () => {
    const id = conversations.contactA
    const users = world().users

    // A read-only member reads the inbox but cannot act.
    expect((await apiErrorOf(unwrap(apiAs('readOnly', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(id))))).status).toBe(403)

    const accepted = await unwrap(apiAs('manager', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(id)))
    expect(accepted).toMatchObject({ conversationId: id, status: 'accepted', requestedBy: 'member', assignedUserId: users.manager.id, assignedUserName: users.manager.fullName })
    // Repeating it is harmless; a colleague cannot silently take it.
    await expect(unwrap(apiAs('manager', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(id)))).resolves.toMatchObject({ id: accepted.id })
    expect((await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(id))))).status).toBe(409)

    // The inbox shows it under "handed over" and in the manager's own view.
    const mine = await unwrap(apiAs('manager', 'a').GET('/api/v1/whatsapp/conversations', { params: { query: { filter: 'mine' } } }))
    expect(mine.items.map((c) => c.id)).toContain(id)
    const adminsOwn = await unwrap(apiAs('admin', 'a').GET('/api/v1/whatsapp/conversations', { params: { query: { filter: 'mine' } } }))
    expect(adminsOwn.items.map((c) => c.id)).not.toContain(id)
    const handedOver = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations', { params: { query: { filter: 'handed_over' } } }))
    expect(handedOver.items.find((c) => c.id === id)?.handover).toMatchObject({ status: 'accepted', assignedUserId: users.manager.id })
    expect(handedOver.items.map((c) => c.id)).not.toContain(conversations.tenantA)

    // Assign: only to an active writer of the company.
    const assign = (userId: string) =>
      unwrap(apiAs('admin', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/assign', { ...conversationPath(id), body: { userId } }))
    expect((await apiErrorOf(assign(users.readOnly.id))).status).toBe(422)
    expect((await apiErrorOf(assign(users.owner.id))).status).toBe(422)
    await expect(assign(users.admin.id)).resolves.toMatchObject({ status: 'accepted', assignedUserId: users.admin.id })

    // Resolve.
    const resolve = () =>
      unwrap(apiAs('manager', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/resolve', { ...conversationPath(id), body: { note: 'Answered by phone' } }))
    await expect(resolve()).resolves.toMatchObject({ status: 'resolved', resolvedByUserId: users.manager.id, resolutionNote: 'Answered by phone' })
    expect((await apiErrorOf(resolve())).status).toBe(409)
    const thread = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', conversationPath(id)))
    expect(thread.handover).toBeUndefined()
  })

  it("never acts on another company's conversation", async () => {
    // The manager is a writer of both companies; with company A active, B's conversation does not exist.
    const call = apiAs('manager', 'a').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(conversations.contactB))
    expect((await apiErrorOf(unwrap(call))).status).toBe(404)
    // The admin of A is not a member of B at all.
    const outsider = apiAs('admin', 'b').POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', conversationPath(conversations.contactB))
    expect((await apiErrorOf(unwrap(outsider))).status).toBe(403)
  })
})

describe('Replies to contacts', () => {
  const reply = (user: WorldUserKey, conversationId: string, body: string, company: 'a' | 'b' = 'a') =>
    unwrap(apiAs(user, company).POST('/api/v1/whatsapp/conversations/{conversationId}/replies', { ...conversationPath(conversationId), body: { body } }))

  it('creates an approved reply from the conversation, queued for delivery', async () => {
    const message = await reply('manager', conversations.contactA, 'Yes, there is parking in the basement.')
    expect(message).toMatchObject({
      direction: 'outbound',
      recipientType: 'contact',
      messageType: 'manual',
      status: 'approved',
      conversationId: conversations.contactA,
      counterpartyNumber: `+${SENDER}`,
      companyNumber: '+27 11 555 0171',
      createdByUserId: world().users.manager.id,
    })
    const jobKey = `${integration().queuePrefix}:message-delivery:message-delivery.${world().companies.a.id.toLowerCase()}.${message.id.toLowerCase()}`
    expect(await listKeysWithPrefix(integration().redisUrl, integration().queuePrefix)).toContain(jobKey)

    const thread = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', conversationPath(conversations.contactA)))
    expect(thread.messages.map((m) => [m.direction, m.body])).toEqual([
      ['inbound', 'Do you have parking?'],
      ['outbound', 'Yes, there is parking in the basement.'],
    ])
  })

  it('refuses read-only members, banking details and replies outside the window', async () => {
    expect((await apiErrorOf(reply('readOnly', conversations.contactA, 'Hi'))).status).toBe(403)
    const bank = await apiErrorOf(reply('manager', conversations.contactA, 'Please pay into account number 62845019876.'))
    expect(bank.status).toBe(422)
    expect(bank.messages.join(' ')).toMatch(/banking details/)

    expectOk(
      await serviceRole().from('whatsapp_conversations').update({ last_inbound_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }).eq('id', conversations.contactA),
      'Close the window',
    )
    try {
      const late = await apiErrorOf(reply('manager', conversations.contactA, 'Sorry for the late answer'))
      expect(late.status).toBe(422)
      expect(late.messages.join(' ')).toMatch(/24-hour customer service window has closed/)
    } finally {
      expectOk(await serviceRole().from('whatsapp_conversations').update({ last_inbound_at: new Date().toISOString() }).eq('id', conversations.contactA), 'Reopen the window')
    }
  })

  it('never sends a free-form message to a tenant, through the API or directly', async () => {
    const refused = await apiErrorOf(reply('admin', conversations.tenantA, 'Hello'))
    expect(refused.status).toBe(422)
    expect(refused.messages.join(' ')).toMatch(/This contact is a tenant/)

    // A writer signed in to the database directly cannot write one either.
    const tenantContact = check(
      await serviceRole().from('whatsapp_conversations').select('contact_id').eq('id', conversations.tenantA).single(),
      'Read the tenant contact',
    ) as { contact_id: string }
    const direct = await signedIn('manager').from('communications').insert({
      company_id: world().companies.a.id,
      channel: 'whatsapp',
      direction: 'outbound',
      message_type: 'manual',
      recipient_type: 'contact',
      contact_id: tenantContact.contact_id,
      conversation_id: conversations.tenantA,
      counterparty_number: world().companies.a.tenants[0]!.whatsappNumber,
      company_number: '+27 11 555 0171',
      body: 'Hello',
      status: 'draft',
    })
    expect(direct.error?.code).toBe('42501')
    const rpc = await signedIn('manager').rpc('reply_to_whatsapp_contact', {
      p_company_id: world().companies.a.id,
      p_conversation_id: conversations.tenantA,
      p_body: 'Hello',
    })
    expect(rpc.data).toEqual([{ outcome: 'tenant', communication_id: null }])
    const { count } = await serviceRole()
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversations.tenantA)
      .eq('direction', 'outbound')
    expect(count).toBe(0)
  })

  it("never replies in another company's conversation", async () => {
    expect((await apiErrorOf(reply('manager', conversations.contactB, 'Hi', 'a'))).status).toBe(404)
  })
})
