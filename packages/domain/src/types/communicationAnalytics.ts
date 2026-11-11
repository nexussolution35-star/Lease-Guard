import type { ISODate } from './common.js'

/** South African calendar dates, both inclusive. */
export interface CommunicationAnalyticsRange {
  from: ISODate
  to: ISODate
}

/**
 * A company's WhatsApp communication figures over a date range (South African calendar days, both inclusive).
 * Messages count on the day they were recorded, by their current status; handovers on the day they were opened; agent
 * runs on the day their message arrived. Test messages are not communications and never count.
 */
export interface CommunicationAnalytics extends CommunicationAnalyticsRange {
  /** Messages received from tenants, owners and contacts. */
  inbound: number
  /** Messages handed to WhatsApp for sending (queued, sent, delivered, read or failed); not drafts, approval requests or rejected ones. */
  outbound: number
  /** Outbound messages Meta reported delivered (read ones included). */
  delivered: number
  /** Outbound messages Meta reported read. */
  read: number
  /** Outbound messages that failed. */
  failed: number
  /** Handovers opened, by the AI agent or by a member. */
  handovers: number
  /** Handovers the AI agent opened. */
  agentHandovers: number
  /** Answers the AI agent sent to contacts. */
  agentReplies: number
  /** Out-of-hours messages the AI agent sent to contacts. */
  outOfHoursMessages: number
  /** Suggested replies the AI agent drafted for staff (internal, never sent). */
  suggestedReplies: number
}
