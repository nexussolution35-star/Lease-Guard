import type { EntityId, ISODateTime } from '../types/index.js'
import type { EligibilityResult } from './communicationEligibility.js'

/**
 * Replies by company staff to a WhatsApp contact (ticket 07). WhatsApp allows a free-form (non-template) message
 * only inside the 24-hour customer service window that opens when the contact writes to the business. Tenants
 * never receive free-form replies: tenant messages stay limited to approved statement and payment types.
 */

/** WhatsApp's customer service window: 24 hours from the contact's last message. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface CustomerServiceWindow {
  open: boolean
  /** When the window closes (or closed); absent when the contact never wrote. */
  closesAt?: ISODateTime
  /** Milliseconds until it closes; 0 when closed. */
  remainingMs: number
}

/** The window that `lastInboundAt` (the contact's last message) opened, as of `now`. */
export function customerServiceWindow(lastInboundAt: ISODateTime | undefined, now: Date): CustomerServiceWindow {
  const from = lastInboundAt === undefined ? Number.NaN : Date.parse(lastInboundAt)
  if (Number.isNaN(from)) return { open: false, remainingMs: 0 }
  const closes = from + CUSTOMER_SERVICE_WINDOW_MS
  const remainingMs = Math.max(0, closes - now.getTime())
  return { open: remainingMs > 0, closesAt: new Date(closes).toISOString(), remainingMs }
}

/** What a reply needs to know about the contact. */
export interface ReplyContact {
  /** E.164; absent when WhatsApp identified the contact by a business-scoped user id only. */
  phoneNumber?: string
  /** Set when the contact is a tenant of the company. */
  tenantId?: EntityId
}

export const TENANT_REPLY_REASON =
  'This contact is a tenant: tenants only receive approved statement and payment messages, never free-form replies'
export const WINDOW_CLOSED_REASON =
  "WhatsApp's 24-hour customer service window has closed: free-form replies are only allowed within 24 hours of the contact's last message"
export const NO_NUMBER_REASON = "WhatsApp has not shared this contact's number, so LeaseGuard cannot reply to them yet"

/**
 * May company staff send a free-form reply to this contact now? Every rule must hold:
 * - the contact is not a tenant (hard product constraint);
 * - the 24-hour customer service window is open;
 * - LeaseGuard knows the contact's WhatsApp number.
 * The backend's outbound gate applies the same rules before the reply is created and again before it is sent.
 */
export function canReplyToContact(contact: ReplyContact, lastInboundAt: ISODateTime | undefined, now: Date): EligibilityResult {
  const reasons: string[] = []
  if (contact.tenantId !== undefined) reasons.push(TENANT_REPLY_REASON)
  if (!customerServiceWindow(lastInboundAt, now).open) reasons.push(WINDOW_CLOSED_REASON)
  if (contact.phoneNumber === undefined) reasons.push(NO_NUMBER_REASON)
  return { eligible: reasons.length === 0, reasons }
}
