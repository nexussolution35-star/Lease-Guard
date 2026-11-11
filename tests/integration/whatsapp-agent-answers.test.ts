import { unwrap } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../backend/src/infrastructure/database/database.types.ts'
import { FakeAgentLlm } from '../../backend/src/messaging/agent.test-helpers.ts'
import { DatabaseAgentRunStore } from '../../backend/src/messaging/agent-run-store.ts'
import { type AgentRuntimeDeps, runAgent } from '../../backend/src/messaging/agent-runtime.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * The AI agent answers contacts; everything else goes to a person (ticket 10). The agent runtime
 * (backend/src/messaging/agent-runtime.ts) runs through its interface against the local stack with the worker's real
 * database side (DatabaseAgentRunStore, service role) and a deterministic fake model that records every prompt; it
 * never calls Anthropic. Two companies with different agents and knowledge: each prompt holds only its own company's
 * approved knowledge; a contact's FAQ is answered once, agent-approved and deliverable through the outbound gate; a
 * tenant is never answered; out of hours the out-of-hours message goes out once; members see only their own runs.
 */

type Db = SupabaseClient<Database>

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const PHONE = { a: `${unique}81`, b: `${unique}82` }
const ACCOUNT = { a: `${unique}83`, b: `${unique}84` }
const SENDER = `2786${unique.slice(-7)}`
const SENDER_2 = `2787${unique.slice(-7)}`
const numberIds: Record<'a' | 'b', string> = { a: '', b: '' }
const conversations: string[] = []
// In letters: a long run of digits in an answer would (rightly) trip the bank-details guard.
const marker = unique.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!)
const KNOWLEDGE = {
  a: { faq: `Atlas visitors park in basement P2 (${marker})`, draft: `Atlas draft answer ${marker}` },
  b: { faq: `Baobab access cards come from reception (${marker})`, draft: `Baobab draft answer ${marker}` },
}

let service: Db | undefined
function serviceDb(): Db {
  const ctx = integration()
  service ??= createClient<Database>(ctx.supabaseUrl, ctx.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return service
}

/** A Supabase client signed in as a world user (Row Level Security applies). */
function signedIn(user: 'admin' | 'manager' | 'readOnly'): Db {
  const ctx = integration()
  return createClient<Database>(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens[user]}` } },
  })
}

/** What the webhook worker does for one message (record_whatsapp_inbound_message): returns the communication. */
async function receive(company: 'a' | 'b', messageId: string, waId: string, body: string): Promise<{ communicationId: string; conversationId: string }> {
  const rows = check(
    await serviceDb().rpc('record_whatsapp_inbound_message', {
      p_company_id: world().companies[company].id,
      p_number_id: numberIds[company],
      p_provider_message_id: messageId,
      p_user_id: null as unknown as string,
      p_wa_id: waId,
      p_profile_name: 'Agent Sender',
      p_body: body,
      p_sent_at: new Date().toISOString(),
    }),
    'Record an inbound message',
  )
  const row = rows[0]!
  expect(row.outcome).toBe('recorded')
  if (!conversations.includes(row.conversation_id)) conversations.push(row.conversation_id)
  return { communicationId: row.communication_id, conversationId: row.conversation_id }
}

/** The worker's agent run for one message, with a fake model; returns what it queued for delivery. */
function agent(llm: FakeAgentLlm | null) {
  const delivered: string[] = []
  const deps: AgentRuntimeDeps = {
    store: new DatabaseAgentRunStore(serviceDb()),
    llm,
    deliver: async ({ communicationId }) => {
      delivered.push(communicationId)
    },
    now: () => new Date(),
  }
  return { delivered, run: (company: 'a' | 'b', communicationId: string) => runAgent(deps, { companyId: world().companies[company].id, communicationId }, { finalAttempt: false }) }
}

/** The fake model answers each company's FAQ from its own knowledge only. */
const faqModel = () =>
  new FakeAgentLlm((prompt) => ({
    action: 'reply',
    replyText: prompt.knowledge.includes(KNOWLEDGE.a.faq) ? KNOWLEDGE.a.faq : KNOWLEDGE.b.faq,
    category: 'faq',
    confidence: 0.95,
  }))

const previousConfigs: unknown[] = []
const previousContacts: unknown[] = []
const createdFaqIds: string[] = []

beforeAll(async () => {
  const db = serviceRole()
  const companies = world().companies
  for (const key of ['a', 'b'] as const) {
    const companyId = companies[key].id
    expectOk(await db.from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: ACCOUNT[key] }), 'Insert the account')
    const number = check(
      await db
        .from('whatsapp_phone_numbers')
        .insert({
          company_id: companyId,
          business_account_id: ACCOUNT[key],
          phone_number_id: PHONE[key],
          display_name: `Agent ${key.toUpperCase()}`,
          display_number: key === 'a' ? '+27 11 555 0181' : '+27 12 555 0282',
          connection_status: 'connected',
        })
        .select('id')
        .single(),
      'Insert the connected number',
    )
    numberIds[key] = number.id
    const existing = check(await db.from('whatsapp_agent_configs').select('*').eq('company_id', companyId), 'Read the agent configuration')
    previousConfigs.push(...existing)
    previousContacts.push(...check(await db.from('whatsapp_agent_handover_contacts').select('*').eq('company_id', companyId), 'Read the handover contacts'))
  }
  const allWeek = (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((day) => ({ day, opens: '00:00', closes: '24:00' }))
  expectOk(
    await db.from('whatsapp_agent_configs').upsert(
      [
        {
          company_id: companies.a.id,
          agent_name: 'Atlas assistant',
          business_description: 'Atlas Properties lets offices in Sandton.',
          operating_hours: allWeek,
          permitted_actions: ['answer_faq', 'draft_tenant_reply'],
          auto_reply_enabled: true,
          out_of_hours_message: 'Atlas is closed.',
        },
        {
          // Never open: every contact message is out of hours.
          company_id: companies.b.id,
          agent_name: 'Baobab assistant',
          business_description: 'Baobab Estates lets warehouses in Pretoria.',
          operating_hours: [],
          permitted_actions: ['answer_faq'],
          auto_reply_enabled: true,
          out_of_hours_message: `Baobab is closed (${marker}).`,
        },
      ],
      { onConflict: 'company_id' },
    ),
    'Configure both agents',
  )
  // The manager is A's only handover contact (another file may have saved others; they are restored afterwards).
  expectOk(await db.from('whatsapp_agent_handover_contacts').delete().in('company_id', [companies.a.id, companies.b.id]), 'Clear the handover contacts')
  expectOk(
    await db.from('whatsapp_agent_handover_contacts').insert({ company_id: companies.a.id, user_id: world().users.manager.id }),
    "Make the manager A's handover contact",
  )
  const faqs = check(
    await db
      .from('whatsapp_knowledge_faqs')
      .insert([
        { company_id: companies.a.id, question: 'Where do visitors park?', answer: KNOWLEDGE.a.faq, status: 'approved', approved_at: new Date().toISOString() },
        { company_id: companies.a.id, question: 'Draft?', answer: KNOWLEDGE.a.draft, status: 'draft' },
        { company_id: companies.b.id, question: 'How do I get an access card?', answer: KNOWLEDGE.b.faq, status: 'approved', approved_at: new Date().toISOString() },
        { company_id: companies.b.id, question: 'Draft?', answer: KNOWLEDGE.b.draft, status: 'draft' },
      ])
      .select('id'),
    'Add both companies’ FAQs',
  )
  createdFaqIds.push(...faqs.map((f) => f.id))
})

afterAll(async () => {
  const db = serviceRole()
  const companyIds = [world().companies.a.id, world().companies.b.id]
  if (conversations.length > 0) {
    expectOk(await db.from('whatsapp_agent_runs').delete().in('conversation_id', conversations), 'Delete the agent runs')
    expectOk(await db.from('notifications').delete().in('company_id', companyIds).like('dedupe_key', 'whatsapp-handover:%'), 'Delete the handover notifications')
    expectOk(await db.from('communications').delete().in('conversation_id', conversations), 'Delete the messages')
    expectOk(await db.from('whatsapp_conversations').delete().in('id', conversations), 'Delete the conversations and their handovers')
  }
  expectOk(await db.from('whatsapp_contacts').delete().in('company_id', companyIds), 'Delete the contacts')
  if (createdFaqIds.length > 0) expectOk(await db.from('whatsapp_knowledge_faqs').delete().in('id', createdFaqIds), 'Delete the FAQs')
  expectOk(await db.from('whatsapp_agent_configs').delete().in('company_id', companyIds), 'Delete the agent configurations')
  if (previousConfigs.length > 0) expectOk(await db.from('whatsapp_agent_configs').insert(previousConfigs), 'Restore the earlier configurations')
  if (previousContacts.length > 0) expectOk(await db.from('whatsapp_agent_handover_contacts').insert(previousContacts), 'Restore the earlier handover contacts')
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', Object.values(PHONE)), 'Delete the numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', Object.values(ACCOUNT)), 'Delete the accounts')
})

describe('The AI agent', () => {
  it("answers a contact's FAQ from its own company's approved knowledge only, once", async () => {
    const llm = faqModel()
    const { run, delivered } = agent(llm)
    const message = await receive('a', `wamid.agent-a-${unique}`, SENDER, 'Where can visitors park?')

    const result = await run('a', message.communicationId)
    expect(result).toMatchObject({ outcome: 'completed', runOutcome: 'replied', notified: 0 })
    if (result.outcome !== 'completed') return
    const replyId = result.replyCommunicationId!
    expect(delivered).toEqual([replyId])

    // The prompt holds A's approved FAQ, never A's draft and nothing of B.
    const prompt = JSON.stringify(llm.prompts[0])
    expect(prompt).toContain(KNOWLEDGE.a.faq)
    expect(prompt).not.toContain(KNOWLEDGE.a.draft)
    expect(prompt).not.toContain(KNOWLEDGE.b.faq)
    expect(prompt).not.toContain('Baobab')

    // The reply: to the contact, approved by the agent run (the outbound gate accepts that for a contact only; unit-tested).
    const reply = check(await serviceDb().from('communications').select('*').eq('id', replyId).single(), 'Read the reply')
    expect(reply).toMatchObject({ direction: 'outbound', recipient_type: 'contact', status: 'approved', body: KNOWLEDGE.a.faq, counterparty_number: `+${SENDER}` })
    const approval = check(await serviceDb().from('message_approvals').select('*').eq('communication_id', replyId).single(), 'Read the approval')
    expect(approval).toMatchObject({ decision: 'approved', decided_by_user_id: null, requested_by_user_id: null })
    expect(approval.decided_by_agent_run_id).toBeTruthy()

    // A retried job never runs or sends again.
    await expect(run('a', message.communicationId)).resolves.toEqual({ outcome: 'already_completed', replyCommunicationId: replyId })
    expect(llm.prompts).toHaveLength(1)
    const replies = check(await serviceDb().from('communications').select('id').eq('conversation_id', message.conversationId).eq('direction', 'outbound'), 'Count replies')
    expect(replies).toHaveLength(1)
  })

  it("builds B's prompt from B's knowledge only, and sends B's out-of-hours message once per window", async () => {
    const llm = faqModel()
    const { run, delivered } = agent(llm)
    const first = await receive('b', `wamid.agent-b1-${unique}`, SENDER, 'How do I get an access card?')
    const firstResult = await run('b', first.communicationId)
    // B has no handover contacts: its property manager (B has no admin in the world) is told.
    expect(firstResult).toMatchObject({ outcome: 'completed', runOutcome: 'out_of_hours', notified: 1 })

    const prompt = JSON.stringify(llm.prompts[0])
    expect(prompt).toContain(KNOWLEDGE.b.faq)
    expect(prompt).not.toContain(KNOWLEDGE.a.faq)
    expect(prompt).not.toContain('Atlas')

    const second = await receive('b', `wamid.agent-b2-${unique}`, SENDER, 'Hello?')
    await expect(run('b', second.communicationId)).resolves.toMatchObject({ outcome: 'completed', runOutcome: 'handed_over', notified: 0 })
    expect(delivered).toHaveLength(1)
    const outOfHours = check(
      await serviceDb().from('communications').select('id').eq('conversation_id', first.conversationId).eq('body', `Baobab is closed (${marker}).`),
      'Count out-of-hours messages',
    )
    expect(outOfHours).toHaveLength(1)
    const handovers = check(await serviceDb().from('whatsapp_handovers').select('requested_by, status').eq('conversation_id', first.conversationId), 'Read handovers')
    expect(handovers).toEqual([{ requested_by: 'agent', status: 'open' }])
  })

  it('never answers a tenant: an internal suggestion for staff and a handover that notifies the handover contact', async () => {
    const { run, delivered } = agent(faqModel())
    const tenantNumber = world().companies.a.tenants[0]!.whatsappNumber.replace('+', '')
    const message = await receive('a', `wamid.agent-t-${unique}`, tenantNumber, 'Where can visitors park?')
    const result = await run('a', message.communicationId)
    expect(result).toMatchObject({ outcome: 'completed', runOutcome: 'handed_over', notified: 1 })
    expect(delivered).toEqual([])
    const outbound = check(await serviceDb().from('communications').select('id').eq('conversation_id', message.conversationId).eq('direction', 'outbound'), 'Count outbound')
    expect(outbound).toEqual([])
    const notification = check(
      await serviceDb().from('notifications').select('user_id, title').eq('company_id', world().companies.a.id).like('dedupe_key', 'whatsapp-handover:%'),
      'Read the notification',
    )
    expect(notification).toContainEqual({ user_id: world().users.manager.id, title: 'WhatsApp conversation needs a person' })

    // Staff see the run and the internal suggestion in the conversation; the suggestion was never sent.
    const thread = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: message.conversationId } } }))
    expect(thread.agentRuns).toHaveLength(1)
    expect(thread.agentRuns[0]).toMatchObject({ outcome: 'handed_over', suggestedReply: KNOWLEDGE.a.faq, category: 'faq', model: 'claude-opus-5-5', inputTokens: 1200 })
    expect(thread.agentRuns[0]!.handoverReason).toMatch(/tenant/i)
    expect(thread.handover).toMatchObject({ requestedBy: 'agent', status: 'open' })
  })

  it('hands a payment question to a person, and a refusal too', async () => {
    const payment = agent(faqModel())
    const asked = await receive('a', `wamid.agent-p-${unique}`, SENDER_2, 'How do I pay my outstanding balance?')
    await expect(payment.run('a', asked.communicationId)).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(payment.delivered).toEqual([])

    const refusal = agent(FakeAgentLlm.always({ refusal: true }))
    const declined = await receive('a', `wamid.agent-r-${unique}`, SENDER_2, 'Something odd')
    await expect(refusal.run('a', declined.communicationId)).resolves.toMatchObject({ runOutcome: 'handed_over' })
    const run = check(await serviceDb().from('whatsapp_agent_runs').select('stop_reason, outcome').eq('communication_id', declined.communicationId).single(), 'Read the run')
    expect(run).toEqual({ stop_reason: 'refusal', outcome: 'handed_over' })
  })

  it("keeps each company's runs to its own members", async () => {
    // The read-only member of A reads A's runs; the admin of A (not a member of B) reads none of B's.
    const own = check(await signedIn('readOnly').from('whatsapp_agent_runs').select('id, company_id'), 'Read runs as A')
    expect(own.length).toBeGreaterThan(0)
    expect(new Set(own.map((r) => r.company_id))).toEqual(new Set([world().companies.a.id]))
    const other = check(await signedIn('admin').from('whatsapp_agent_runs').select('id').eq('company_id', world().companies.b.id), "Read B's runs as A's admin")
    expect(other).toEqual([])
    // Nobody signed in writes runs.
    const write = await signedIn('admin').from('whatsapp_agent_runs').update({ outcome: 'replied' }).eq('company_id', world().companies.a.id).select('id')
    expect(write.error?.code).toBe('42501')
    // Through the API, B's conversation does not exist for A.
    const bConversation = conversations[1]!
    const call = apiAs('admin', 'a').GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: bConversation } } })
    expect((await apiErrorOf(unwrap(call))).status).toBe(404)
  })
})
