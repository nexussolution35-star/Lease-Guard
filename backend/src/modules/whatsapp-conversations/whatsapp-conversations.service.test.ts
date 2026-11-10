import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { communicationRow } from '../communications/communications.test-helpers'
import { WhatsAppConversationsService } from './whatsapp-conversations.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const CONVERSATION = '6f1d2c1e-0000-4000-8000-0000000000f1'
const NUMBER = '6f1d2c1e-0000-4000-8000-0000000000f2'
const CONTACT = '6f1d2c1e-0000-4000-8000-0000000000f3'
const TENANT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const MEMBER = '6f1d2c1e-0000-4000-8000-0000000000a1'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: CONVERSATION,
  company_id: COMPANY,
  number_id: NUMBER,
  last_inbound_at: '2026-11-10T08:00:00+00:00',
  last_message_at: '2026-11-10T08:00:00+00:00',
  created_at: '2026-11-09T08:00:00+00:00',
  updated_at: '2026-11-10T08:00:00+00:00',
  contact: { id: CONTACT, profile_name: 'Bongani', wa_id: '27821110001', tenant_id: TENANT, tenant: { trading_name: 'Dlamini Cellular', legal_name: 'Dlamini Cellular (Pty) Ltd' } },
  number: { display_number: '+27 11 555 0100', phone_number_id: '1110001' },
  ...overrides,
})

const service = new WhatsAppConversationsService()
const query = { page: 1, pageSize: 25 }

describe('WhatsAppConversationsService', () => {
  it("lists the company's conversations, most recent first, with the contact, tenant and latest message", async () => {
    const db = fakeDb(() => ({ data: [row({ messages: [{ body: 'Statement   query\nplease' }] })], error: null, count: 1 }))
    const page = await service.list(db.client, COMPANY, MEMBER, query)
    expect(page).toEqual({
      items: [
        {
          id: CONVERSATION,
          companyId: COMPANY,
          numberId: NUMBER,
          companyNumber: '+27 11 555 0100',
          contact: { id: CONTACT, profileName: 'Bongani', phoneNumber: '+27821110001', tenantId: TENANT, tenantName: 'Dlamini Cellular' },
          lastInboundAt: '2026-11-10T08:00:00+00:00',
          lastMessageAt: '2026-11-10T08:00:00+00:00',
          lastMessagePreview: 'Statement query please',
          createdAt: '2026-11-09T08:00:00+00:00',
          updatedAt: '2026-11-10T08:00:00+00:00',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    })
    const q = db.queries[0]!
    expect(q.table).toBe('whatsapp_conversations')
    expect(callsTo(q, 'eq')).toEqual([['company_id', COMPANY]])
    expect(callsTo(q, 'order')).toContainEqual(['last_message_at', { ascending: false }])
    expect(String(callsTo(q, 'select')[0]![0])).not.toContain('access_token_reference')
    // Only the unresolved handover is embedded.
    expect(callsTo(q, 'neq')).toEqual([['handovers.status', 'resolved']])
  })

  it("shows each conversation's unresolved handover with the assignee's name", async () => {
    const handover = {
      id: 'h1',
      company_id: COMPANY,
      conversation_id: CONVERSATION,
      status: 'open',
      reason: 'Complaint about parking',
      requested_by: 'agent',
      requested_by_user_id: null,
      assigned_user_id: MEMBER,
      accepted_at: null,
      resolved_at: null,
      resolved_by_user_id: null,
      resolution_note: null,
      created_at: '2026-11-10T08:00:00+00:00',
      updated_at: '2026-11-10T08:00:00+00:00',
    }
    const db = fakeDb((q) =>
      q.table === 'profiles' ? { data: [{ id: MEMBER, full_name: 'Naledi van der Merwe' }], error: null } : { data: [row({ handovers: [handover] })], error: null, count: 1 },
    )
    const page = await service.list(db.client, COMPANY, MEMBER, query)
    expect(page.items[0]?.handover).toEqual({
      id: 'h1',
      companyId: COMPANY,
      conversationId: CONVERSATION,
      status: 'open',
      reason: 'Complaint about parking',
      requestedBy: 'agent',
      assignedUserId: MEMBER,
      assignedUserName: 'Naledi van der Merwe',
      createdAt: '2026-11-10T08:00:00+00:00',
      updatedAt: '2026-11-10T08:00:00+00:00',
    })
    expect(callsTo(db.queries.find((q) => q.table === 'profiles')!, 'in')).toEqual([['id', [MEMBER]]])
  })

  it('lists only handed-over conversations, or those assigned to the caller', async () => {
    const handedOver = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(handedOver.client, COMPANY, MEMBER, { ...query, filter: 'handed_over' })
    const q = handedOver.queries[0]!
    expect(String(callsTo(q, 'select')[0]![0])).toContain('whatsapp_handovers_conversation_fk!inner(')
    expect(callsTo(q, 'eq')).toEqual([['company_id', COMPANY]])

    const mine = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(mine.client, COMPANY, MEMBER, { ...query, filter: 'mine' })
    expect(callsTo(mine.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['handovers.assigned_user_id', MEMBER],
    ])
  })

  it('shows a contact identified only by a business-scoped user id without a number', async () => {
    const db = fakeDb(() => ({ data: [row({ contact: { id: CONTACT, profile_name: null, wa_id: null, tenant_id: null, tenant: null } })], error: null, count: 1 }))
    const page = await service.list(db.client, COMPANY, MEMBER, { ...query, numberId: NUMBER })
    expect(page.items[0]?.contact).toEqual({ id: CONTACT })
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['number_id', NUMBER],
    ])
  })

  it('returns a conversation with its messages oldest first', async () => {
    const answer = (q: RecordedQuery): FakeResult =>
      q.table === 'whatsapp_conversations'
        ? { data: row(), error: null }
        : {
            data: [
              communicationRow({ id: 'm2', body: 'Second', direction: 'inbound', status: 'received', message_type: 'inbound_reply' }),
              communicationRow({ id: 'm1', body: 'First', direction: 'inbound', status: 'received', message_type: 'inbound_reply' }),
            ],
            error: null,
          }
    const db = fakeDb(answer)
    const conversation = await service.get(db.client, COMPANY, CONVERSATION)
    expect(conversation.messages.map((m) => m.body)).toEqual(['First', 'Second'])
    expect(conversation.lastMessagePreview).toBe('Second')
    const messages = db.queries.find((q) => q.table === 'communications')!
    expect(callsTo(messages, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['conversation_id', CONVERSATION],
    ])
  })

  it('answers 404 for a conversation the company does not have', async () => {
    const db = fakeDb((q) => (q.table === 'whatsapp_conversations' ? { data: null, error: null } : { data: [], error: null }))
    await expect(service.get(db.client, COMPANY, CONVERSATION)).rejects.toBeInstanceOf(NotFoundException)
  })
})
