import type { WhatsAppHandover } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import type { CompanyMember } from '@/features/users/api/source'

import { assignableMembers, formatRemaining, handoverStatusText, replyFormSchema } from './handover'

const handover = (overrides: Partial<WhatsAppHandover> = {}): WhatsAppHandover => ({
  id: 'h1',
  companyId: 'c1',
  conversationId: 'v1',
  status: 'open',
  reason: 'Complaint',
  requestedBy: 'agent',
  createdAt: '2026-11-10T08:00:00Z',
  updatedAt: '2026-11-10T08:00:00Z',
  ...overrides,
})

const member = (id: string, role: string, status = 'active', companyId = 'c1') =>
  ({ id, fullName: id, email: `${id}@example.co.za`, status, memberships: [{ companyId, role }] }) as unknown as CompanyMember

describe('handover helpers', () => {
  it('offers only active company admins and property managers of the company', () => {
    const members = [member('admin', 'company_admin'), member('pm', 'property_manager'), member('reader', 'read_only'), member('owner', 'property_owner'), member('gone', 'property_manager', 'deactivated'), member('other', 'property_manager', 'active', 'c2')]
    expect(assignableMembers(members, 'c1').map((m) => m.id)).toEqual(['admin', 'pm'])
  })

  it('says who handles the conversation', () => {
    expect(handoverStatusText(handover(), 'me')).toBe('The AI agent asked for a person')
    expect(handoverStatusText(handover({ requestedBy: 'member' }), 'me')).toBe('Waiting for a person')
    expect(handoverStatusText(handover({ assignedUserId: 'me' }), 'me')).toBe('Assigned to you; accept it to take the conversation over')
    expect(handoverStatusText(handover({ assignedUserId: 'x', assignedUserName: 'Naledi' }), 'me')).toBe('Assigned to Naledi, waiting for them to accept')
    expect(handoverStatusText(handover({ status: 'accepted', assignedUserId: 'me' }), 'me')).toBe('Taken over by you')
    expect(handoverStatusText(handover({ status: 'accepted', assignedUserId: 'x' }), 'me')).toBe('Taken over by a colleague')
  })

  it('formats the time left in the window', () => {
    expect(formatRemaining(5 * 3_600_000 + 12 * 60_000 + 30_000)).toBe('5 h 12 min')
    expect(formatRemaining(12 * 60_000)).toBe('12 min')
    expect(formatRemaining(10_000)).toBe('less than a minute')
  })

  it('validates a reply', () => {
    expect(replyFormSchema.safeParse({ body: '  ' }).success).toBe(false)
    expect(replyFormSchema.safeParse({ body: 'x'.repeat(4097) }).success).toBe(false)
    expect(replyFormSchema.safeParse({ body: 'Thanks' }).success).toBe(true)
  })
})
