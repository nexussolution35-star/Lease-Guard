import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import type { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { communicationRow } from '../communications/communications.test-helpers'
import { WhatsAppConversationActionsService } from './whatsapp-conversation-actions.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const CONVERSATION = '6f1d2c1e-0000-4000-8000-0000000000f1'
const NUMBER = '6f1d2c1e-0000-4000-8000-0000000000f2'
const CONTACT = '6f1d2c1e-0000-4000-8000-0000000000f3'
const HANDOVER = '6f1d2c1e-0000-4000-8000-0000000000f4'
const REPLY = '6f1d2c1e-0000-4000-8000-0000000000f5'
const MEMBER = '6f1d2c1e-0000-4000-8000-0000000000a1'
const NOW = new Date('2026-11-10T12:00:00Z')

const handoverRow = (overrides: Record<string, unknown> = {}) => ({
  id: HANDOVER,
  company_id: COMPANY,
  conversation_id: CONVERSATION,
  status: 'accepted',
  reason: 'The tenant asked about a payment arrangement',
  requested_by: 'agent',
  requested_by_user_id: null,
  assigned_user_id: MEMBER,
  accepted_at: '2026-11-10T11:00:00+00:00',
  resolved_at: null,
  resolved_by_user_id: null,
  resolution_note: null,
  created_at: '2026-11-10T10:00:00+00:00',
  updated_at: '2026-11-10T11:00:00+00:00',
  ...overrides,
})

const thread = {
  whatsapp_conversations: { id: CONVERSATION, company_id: COMPANY, contact_id: CONTACT, number_id: NUMBER, last_inbound_at: '2026-11-10T10:00:00Z' },
  whatsapp_contacts: { id: CONTACT, company_id: COMPANY, wa_id: '27829990001', tenant_id: null },
  whatsapp_phone_numbers: { id: NUMBER, company_id: COMPANY, phone_number_id: '1110001', connection_status: 'connected' },
}

class TestActions extends WhatsAppConversationActionsService {
  protected override now(): Date {
    return NOW
  }
}

function harness(answer: (query: RecordedQuery) => FakeResult | undefined) {
  const db = fakeDb((query) => {
    const custom = answer(query)
    if (custom) return custom
    if (query.table === 'whatsapp_handovers') return { data: handoverRow(), error: null }
    if (query.table === 'profiles') return { data: [{ id: MEMBER, full_name: 'Naledi van der Merwe' }], error: null }
    if (query.table in thread) return { data: thread[query.table as keyof typeof thread], error: null }
    return { data: null, error: null }
  })
  const enqueue = vi.fn(async () => 'job-1')
  const service = new TestActions({ enqueue } as unknown as QueueProducer)
  return { db, service, enqueue }
}

const outcome = (value: string, handoverId: string | null = HANDOVER): FakeResult => ({ data: [{ outcome: value, handover_id: handoverId }], error: null })

describe('WhatsAppConversationActionsService: handovers', () => {
  it("accepts a conversation's handover through the database function and returns it with the assignee's name", async () => {
    const { db, service } = harness((q) => (q.table === 'rpc:accept_whatsapp_handover' ? outcome('accepted') : undefined))
    await expect(service.accept(db.client, COMPANY, CONVERSATION)).resolves.toMatchObject({
      id: HANDOVER,
      conversationId: CONVERSATION,
      status: 'accepted',
      requestedBy: 'agent',
      assignedUserId: MEMBER,
      assignedUserName: 'Naledi van der Merwe',
    })
    expect(rpcArgs(db.queries[0]!)).toEqual({ p_company_id: COMPANY, p_conversation_id: CONVERSATION })
    const read = db.queries.find((q) => q.table === 'whatsapp_handovers')!
    expect(callsTo(read, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', HANDOVER],
    ])
  })

  it('answers 409 when a colleague already accepted it, and 404 for a conversation the company does not have', async () => {
    const taken = harness((q) => (q.table === 'rpc:accept_whatsapp_handover' ? outcome('accepted_by_other') : undefined))
    await expect(taken.service.accept(taken.db.client, COMPANY, CONVERSATION)).rejects.toBeInstanceOf(ConflictException)
    const missing = harness((q) => (q.table === 'rpc:accept_whatsapp_handover' ? outcome('not_found', null) : undefined))
    await expect(missing.service.accept(missing.db.client, COMPANY, CONVERSATION)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps a refusal of the caller by the database to 403', async () => {
    const { db, service } = harness((q) =>
      q.table === 'rpc:accept_whatsapp_handover' ? { data: null, error: { code: '42501', message: 'only company admins and property managers handle conversations' } } : undefined,
    )
    await expect(service.accept(db.client, COMPANY, CONVERSATION)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('assigns to a member and refuses an assignee who cannot handle conversations', async () => {
    const ok = harness((q) => (q.table === 'rpc:assign_whatsapp_handover' ? outcome('assigned') : undefined))
    await expect(ok.service.assign(ok.db.client, COMPANY, CONVERSATION, MEMBER)).resolves.toMatchObject({ id: HANDOVER })
    expect(rpcArgs(ok.db.queries[0]!)).toEqual({ p_company_id: COMPANY, p_conversation_id: CONVERSATION, p_assignee: MEMBER })
    const invalid = harness((q) => (q.table === 'rpc:assign_whatsapp_handover' ? outcome('invalid_assignee', null) : undefined))
    await expect(invalid.service.assign(invalid.db.client, COMPANY, CONVERSATION, MEMBER)).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('resolves with a note, and answers 409 when there is nothing to resolve', async () => {
    const ok = harness((q) =>
      q.table === 'rpc:resolve_whatsapp_handover' ? outcome('resolved') : q.table === 'whatsapp_handovers' ? { data: handoverRow({ status: 'resolved', resolved_at: '2026-11-10T12:00:00+00:00', resolved_by_user_id: MEMBER, resolution_note: 'Called back' }), error: null } : undefined,
    )
    await expect(ok.service.resolve(ok.db.client, COMPANY, CONVERSATION, 'Called back')).resolves.toMatchObject({ status: 'resolved', resolutionNote: 'Called back', resolvedByUserId: MEMBER })
    expect(rpcArgs(ok.db.queries[0]!)).toEqual({ p_company_id: COMPANY, p_conversation_id: CONVERSATION, p_note: 'Called back' })
    const none = harness((q) => (q.table === 'rpc:resolve_whatsapp_handover' ? outcome('no_handover', null) : undefined))
    await expect(none.service.resolve(none.db.client, COMPANY, CONVERSATION, undefined)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('WhatsAppConversationActionsService: replies to contacts', () => {
  const replyCreated = (q: RecordedQuery): FakeResult | undefined =>
    q.table === 'rpc:reply_to_whatsapp_contact'
      ? { data: [{ outcome: 'created', communication_id: REPLY }], error: null }
      : q.table === 'communications'
        ? { data: communicationRow({ id: REPLY, message_type: 'manual', recipient_type: 'contact', tenant_id: null, status: 'approved', body: 'Yes, we have parking.' }), error: null }
        : undefined

  it('checks the reply, creates it approved through the database function and hands it to the delivery queue', async () => {
    const { db, service, enqueue } = harness(replyCreated)
    await expect(service.reply(db.client, COMPANY, CONVERSATION, 'Yes, we have parking.')).resolves.toMatchObject({ id: REPLY, status: 'approved', recipientType: 'contact' })
    const rpc = db.queries.find((q) => q.table === 'rpc:reply_to_whatsapp_contact')!
    expect(rpcArgs(rpc)).toEqual({ p_company_id: COMPANY, p_conversation_id: CONVERSATION, p_body: 'Yes, we have parking.' })
    expect(enqueue).toHaveBeenCalledWith('message-delivery', { companyId: COMPANY, communicationId: REPLY })
    // The gate read the conversation before anything was written.
    expect(db.queries.findIndex((q) => q.table === 'whatsapp_conversations')).toBeLessThan(db.queries.indexOf(rpc))
  })

  it('refuses (422, every reason) outside the window, to a tenant, or with banking details, writing nothing', async () => {
    const { db, service, enqueue } = harness((q) =>
      q.table === 'whatsapp_conversations'
        ? { data: { ...thread.whatsapp_conversations, last_inbound_at: '2026-11-09T11:00:00Z' }, error: null }
        : q.table === 'whatsapp_contacts'
          ? { data: { ...thread.whatsapp_contacts, tenant_id: 'tenant-1' }, error: null }
          : undefined,
    )
    const refused = service.reply(db.client, COMPANY, CONVERSATION, 'Pay into account number 62845019876')
    await expect(refused).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(refused).rejects.toMatchObject({
      response: {
        message: [
          expect.stringMatching(/^This contact is a tenant/),
          expect.stringMatching(/24-hour customer service window has closed/),
          expect.stringMatching(/may not contain banking details/),
        ],
      },
    })
    expect(db.queries.some((q) => q.table.startsWith('rpc:'))).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('answers 404 for a conversation the company does not have', async () => {
    const { db, service } = harness((q) => (q.table === 'whatsapp_conversations' ? { data: null, error: null } : undefined))
    await expect(service.reply(db.client, COMPANY, CONVERSATION, 'Hello')).rejects.toBeInstanceOf(NotFoundException)
  })

  it("answers 422 when the database's own check refuses it (the window closed meanwhile)", async () => {
    const { db, service, enqueue } = harness((q) =>
      q.table === 'rpc:reply_to_whatsapp_contact' ? { data: [{ outcome: 'window_closed', communication_id: null }], error: null } : undefined,
    )
    await expect(service.reply(db.client, COMPANY, CONVERSATION, 'Hello')).rejects.toMatchObject({
      response: { message: [expect.stringMatching(/24-hour customer service window has closed/)] },
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
})
