import { describe, expect, it } from 'vitest'

import { canReplyToContact, CUSTOMER_SERVICE_WINDOW_MS, customerServiceWindow } from './contactReply.js'

const NOW = new Date('2026-11-10T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

describe('customerServiceWindow', () => {
  it('is open for 24 hours after the contact last wrote, and says when it closes', () => {
    expect(CUSTOMER_SERVICE_WINDOW_MS).toBe(24 * 3_600_000)
    expect(customerServiceWindow(hoursAgo(1), NOW)).toEqual({ open: true, closesAt: '2026-11-11T11:00:00.000Z', remainingMs: 23 * 3_600_000 })
  })

  it('is closed exactly 24 hours later and after', () => {
    expect(customerServiceWindow(hoursAgo(24), NOW)).toEqual({ open: false, closesAt: '2026-11-10T12:00:00.000Z', remainingMs: 0 })
    expect(customerServiceWindow(hoursAgo(30), NOW).open).toBe(false)
  })

  it('is closed when the contact never wrote or the time is not a date', () => {
    expect(customerServiceWindow(undefined, NOW)).toEqual({ open: false, remainingMs: 0 })
    expect(customerServiceWindow('yesterday', NOW)).toEqual({ open: false, remainingMs: 0 })
  })
})

describe('canReplyToContact', () => {
  const contact = { phoneNumber: '+27829990001' }

  it('allows a free-form reply to a contact with a number inside the window', () => {
    expect(canReplyToContact(contact, hoursAgo(2), NOW)).toEqual({ eligible: true, reasons: [] })
  })

  it('never allows one to a tenant, whatever the window', () => {
    const result = canReplyToContact({ ...contact, tenantId: 'c1' }, hoursAgo(1), NOW)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual([
      'This contact is a tenant: tenants only receive approved statement and payment messages, never free-form replies',
    ])
  })

  it('refuses outside the 24-hour customer service window', () => {
    expect(canReplyToContact(contact, hoursAgo(25), NOW).reasons).toEqual([
      "WhatsApp's 24-hour customer service window has closed: free-form replies are only allowed within 24 hours of the contact's last message",
    ])
    expect(canReplyToContact(contact, undefined, NOW).eligible).toBe(false)
  })

  it('refuses when WhatsApp has not shared the contact\'s number', () => {
    expect(canReplyToContact({}, hoursAgo(1), NOW).reasons).toEqual([
      "WhatsApp has not shared this contact's number, so LeaseGuard cannot reply to them yet",
    ])
  })

  it('lists every reason', () => {
    expect(canReplyToContact({ tenantId: 'c1' }, hoursAgo(48), NOW).reasons).toHaveLength(3)
  })
})
