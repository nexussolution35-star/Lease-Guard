import { describe, expect, it } from 'vitest'

import type { AgentDecision } from '../types/index.js'
import {
  AGENT_CONFIDENCE_THRESHOLD,
  AGENT_REPLY_MAX_LENGTH,
  type AgentPolicyInput,
  applyAgentPolicy,
  findRestrictedContactTopics,
  operatingHoursState,
  outOfHoursDedupeSince,
} from './agentPolicy.js'

// Tuesday 10 November 2026, 10:00 in South Africa (UTC+2).
const TUESDAY_10AM = new Date('2026-11-10T08:00:00Z')
const OFFICE_HOURS = [
  { day: 'monday', opens: '08:00', closes: '17:00' },
  { day: 'tuesday', opens: '08:00', closes: '17:00' },
] as const

describe('operatingHoursState', () => {
  it('is open inside a period in the agent timezone', () => {
    expect(operatingHoursState([...OFFICE_HOURS], 'Africa/Johannesburg', TUESDAY_10AM)).toEqual({ open: true })
  })

  it('is closed outside every period and says since when', () => {
    // Tuesday 18:30 SAST: closed since 17:00 SAST (15:00 UTC).
    const evening = new Date('2026-11-10T16:30:00Z')
    expect(operatingHoursState([...OFFICE_HOURS], 'Africa/Johannesburg', evening)).toEqual({ open: false, closedSince: '2026-11-10T15:00:00.000Z' })
    // Wednesday 09:00 SAST: closed since Tuesday 17:00.
    const wednesday = new Date('2026-11-11T07:00:00Z')
    expect(operatingHoursState([...OFFICE_HOURS], 'Africa/Johannesburg', wednesday)).toEqual({ open: false, closedSince: '2026-11-10T15:00:00.000Z' })
  })

  it('wraps around the week', () => {
    // Monday 07:00 SAST: closed since last Tuesday 17:00.
    const monday = new Date('2026-11-16T05:00:00Z')
    expect(operatingHoursState([...OFFICE_HOURS], 'Africa/Johannesburg', monday)).toEqual({ open: false, closedSince: '2026-11-10T15:00:00.000Z' })
  })

  it('is never open without periods', () => {
    expect(operatingHoursState([], 'Africa/Johannesburg', TUESDAY_10AM)).toEqual({ open: false })
  })

  it('treats 24:00 as the end of the day', () => {
    const late = new Date('2026-11-10T21:59:00Z') // 23:59 SAST
    expect(operatingHoursState([{ day: 'tuesday', opens: '20:00', closes: '24:00' }], 'Africa/Johannesburg', late).open).toBe(true)
  })

  it('falls back to South African time for an unknown timezone', () => {
    expect(operatingHoursState([...OFFICE_HOURS], 'Not/AZone', TUESDAY_10AM)).toEqual({ open: true })
  })
})

describe('outOfHoursDedupeSince', () => {
  it('is the later of the closing time and 24 hours ago', () => {
    expect(outOfHoursDedupeSince({ open: false, closedSince: '2026-11-10T15:00:00.000Z' }, new Date('2026-11-10T16:30:00Z'))).toBe('2026-11-10T15:00:00.000Z')
    expect(outOfHoursDedupeSince({ open: false, closedSince: '2026-11-07T15:00:00.000Z' }, new Date('2026-11-10T16:30:00Z'))).toBe('2026-11-09T16:30:00.000Z')
    expect(outOfHoursDedupeSince({ open: false }, new Date('2026-11-10T16:30:00Z'))).toBe('2026-11-09T16:30:00.000Z')
  })
})

describe('findRestrictedContactTopics', () => {
  it('finds payment, dispute, lease expiry, renewal and escalation content', () => {
    expect(findRestrictedContactTopics('How do I pay my arrears?')).toEqual(['payment'])
    expect(findRestrictedContactTopics('I dispute this invoice')).toEqual(['payment', 'dispute'])
    expect(findRestrictedContactTopics('When does my lease expire? Can I renew?')).toEqual(['lease_expiry', 'renewal'])
    expect(findRestrictedContactTopics('Is there a rent increase next year?')).toEqual(['escalation'])
  })

  it('leaves ordinary questions alone', () => {
    expect(findRestrictedContactTopics('Where can visitors park?')).toEqual([])
    expect(findRestrictedContactTopics('What are your office hours?')).toEqual([])
  })
})

const faqAnswer: AgentDecision = {
  action: 'reply',
  replyText: 'Visitors park in bays 1 to 10 at the main entrance.',
  category: 'faq',
  confidence: 0.92,
}

function input(overrides: Partial<AgentPolicyInput> = {}): AgentPolicyInput {
  return {
    sender: 'contact',
    config: {
      autoReplyEnabled: true,
      permittedActions: ['answer_faq', 'share_business_info', 'draft_tenant_reply'],
      operatingHours: [...OFFICE_HOURS],
      timezone: 'Africa/Johannesburg',
      outOfHoursMessage: 'We are closed. We will reply during office hours.',
    },
    model: { kind: 'decision', decision: faqAnswer },
    inboundText: 'Where can visitors park?',
    windowOpen: true,
    contactHasNumber: true,
    humanHandling: false,
    now: TUESDAY_10AM,
    ...overrides,
  }
}

describe('applyAgentPolicy', () => {
  it('answers a contact FAQ inside the window and operating hours', () => {
    expect(applyAgentPolicy(input())).toEqual({ outcome: 'replied', reply: { kind: 'answer', text: faqAnswer.replyText } })
  })

  it('never answers a tenant: an internal suggestion and a handover', () => {
    const result = applyAgentPolicy(input({ sender: 'tenant' }))
    expect(result.outcome).toBe('handed_over')
    expect(result.reply).toBeUndefined()
    expect(result.suggestedReply).toBe(faqAnswer.replyText)
    expect(result.handoverReason).toMatch(/tenant/i)
  })

  it('gives no tenant suggestion unless drafting tenant replies is permitted', () => {
    const result = applyAgentPolicy(input({ sender: 'tenant', config: { ...input().config, permittedActions: ['answer_faq'] } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.suggestedReply).toBeUndefined()
  })

  it('hands a tenant over even when the model says ignore, and outside hours (no out-of-hours message)', () => {
    const evening = new Date('2026-11-10T18:00:00Z')
    const result = applyAgentPolicy(input({ sender: 'tenant', now: evening, model: { kind: 'decision', decision: { ...faqAnswer, action: 'ignore' } } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.reply).toBeUndefined()
  })

  it.each([
    ['complaint', /complaint/i],
    ['payment_or_arrangement', /payment/i],
    ['dispute', /dispute/i],
    ['lease_question', /lease/i],
  ] as const)('hands over a %s', (category, reason) => {
    const result = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, category } } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.handoverReason).toMatch(reason)
    expect(result.reply).toBeUndefined()
  })

  it('hands over a refusal, a model error and an unavailable agent', () => {
    for (const model of [{ kind: 'refusal' } as const, { kind: 'error', reason: 'Claude was overloaded' } as const, { kind: 'unavailable' } as const]) {
      const result = applyAgentPolicy(input({ model }))
      expect(result.outcome).toBe('handed_over')
      expect(result.reply).toBeUndefined()
      expect(result.suggestedReply).toBeUndefined()
    }
    expect(applyAgentPolicy(input({ model: { kind: 'refusal' } })).handoverReason).toMatch(/declined/i)
    expect(applyAgentPolicy(input({ model: { kind: 'error', reason: 'Claude was overloaded' } })).handoverReason).toMatch(/overloaded/)
  })

  it('hands over low confidence', () => {
    const result = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, confidence: AGENT_CONFIDENCE_THRESHOLD - 0.01 } } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.handoverReason).toMatch(/confiden/i)
    expect(result.suggestedReply).toBe(faqAnswer.replyText)
  })

  it('hands over when the model asks for a person', () => {
    const result = applyAgentPolicy(input({ model: { kind: 'decision', decision: { action: 'handover', handoverReason: 'Wants to view a unit', category: 'other', confidence: 0.9 } } }))
    expect(result).toEqual({ outcome: 'handed_over', handoverReason: 'Wants to view a unit' })
  })

  it('blocks a reply with bank details and does not keep it as a suggestion', () => {
    const decision = { ...faqAnswer, replyText: 'Pay into account 1234567890, branch code 250655.' }
    const result = applyAgentPolicy(input({ model: { kind: 'decision', decision } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.handoverReason).toMatch(/bank/i)
    expect(result.suggestedReply).toBeUndefined()
  })

  it('blocks payment, dispute, lease-expiry and renewal content in the message or the reply', () => {
    for (const replyText of ['You can pay by EFT.', 'Your lease expires in March.', 'You may renew for 3 years.', 'Disputes go to our lawyer.']) {
      const result = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, replyText } } }))
      expect(result.outcome, replyText).toBe('handed_over')
    }
    const inbound = applyAgentPolicy(input({ inboundText: 'Can I renew my lease?' }))
    expect(inbound.outcome).toBe('handed_over')
    expect(inbound.handoverReason).toMatch(/renewal/i)
  })

  it('hands over a reply that is too long or empty', () => {
    const long = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, replyText: 'a'.repeat(AGENT_REPLY_MAX_LENGTH + 1) } } }))
    expect(long.outcome).toBe('handed_over')
    const empty = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, replyText: '  ' } } }))
    expect(empty.outcome).toBe('handed_over')
  })

  it('needs the permitted action for the category', () => {
    const notPermitted = applyAgentPolicy(input({ config: { ...input().config, permittedActions: ['share_business_info'] } }))
    expect(notPermitted.outcome).toBe('handed_over')
    expect(notPermitted.handoverReason).toMatch(/not permitted/i)
    const businessInfo = applyAgentPolicy(
      input({ config: { ...input().config, permittedActions: ['share_business_info'] }, model: { kind: 'decision', decision: { ...faqAnswer, category: 'business_info' } } }),
    )
    expect(businessInfo.outcome).toBe('replied')
    const other = applyAgentPolicy(input({ model: { kind: 'decision', decision: { ...faqAnswer, category: 'other' } } }))
    expect(other.outcome).toBe('handed_over')
  })

  it('hands over when auto-reply is off, keeping the suggestion', () => {
    const result = applyAgentPolicy(input({ config: { ...input().config, autoReplyEnabled: false } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.handoverReason).toMatch(/auto-reply/i)
    expect(result.suggestedReply).toBe(faqAnswer.replyText)
  })

  it('never sends a free-form message outside the 24-hour window or without a number', () => {
    expect(applyAgentPolicy(input({ windowOpen: false })).outcome).toBe('handed_over')
    expect(applyAgentPolicy(input({ contactHasNumber: false })).outcome).toBe('handed_over')
    const evening = new Date('2026-11-10T18:00:00Z')
    expect(applyAgentPolicy(input({ windowOpen: false, now: evening })).reply).toBeUndefined()
  })

  it('sends the out-of-hours message outside operating hours and hands over', () => {
    const evening = new Date('2026-11-10T18:00:00Z')
    const result = applyAgentPolicy(input({ now: evening }))
    expect(result.outcome).toBe('out_of_hours')
    expect(result.reply).toEqual({ kind: 'out_of_hours', text: 'We are closed. We will reply during office hours.' })
    expect(result.handoverReason).toMatch(/outside operating hours/i)
    expect(result.suggestedReply).toBe(faqAnswer.replyText)
    expect(result.outOfHoursSince).toBe('2026-11-10T15:00:00.000Z')
  })

  it('sends the out-of-hours message for a complaint too, handing it over with the complaint reason', () => {
    const evening = new Date('2026-11-10T18:00:00Z')
    const result = applyAgentPolicy(input({ now: evening, model: { kind: 'decision', decision: { ...faqAnswer, category: 'complaint' } } }))
    expect(result.outcome).toBe('out_of_hours')
    expect(result.handoverReason).toMatch(/complaint/i)
  })

  it('hands over outside hours without an out-of-hours message', () => {
    const evening = new Date('2026-11-10T18:00:00Z')
    const result = applyAgentPolicy(input({ now: evening, config: { ...input().config, outOfHoursMessage: undefined } }))
    expect(result.outcome).toBe('handed_over')
    expect(result.reply).toBeUndefined()
  })

  it('does not answer while a person handles the conversation', () => {
    const result = applyAgentPolicy(input({ humanHandling: true }))
    expect(result.outcome).toBe('handed_over')
    expect(result.reply).toBeUndefined()
    expect(result.suggestedReply).toBe(faqAnswer.replyText)
  })

  it('ignores a contact message with nothing to answer', () => {
    const result = applyAgentPolicy(input({ model: { kind: 'decision', decision: { action: 'ignore', category: 'other', confidence: 0.95 } } }))
    expect(result).toEqual({ outcome: 'ignored' })
  })
})
