import type { WhatsAppAgentRun } from './agent.js'
import type { Communication } from './communication.js'
import type { CompanyScoped, EntityId, ISODateTime } from './common.js'

/**
 * The person on the other side of a WhatsApp conversation, as WhatsApp identified them to the company. Meta may
 * identify a sender by a business-scoped user id only, so the number can be unknown.
 */
export interface WhatsAppConversationContact {
  id: EntityId
  /** The sender's WhatsApp profile name, when Meta sent one. */
  profileName?: string
  /** E.164, e.g. `+27821234567`, when Meta sent the sender's number. */
  phoneNumber?: string
  /** A tenant of the same company whose WhatsApp number is the contact's number. */
  tenantId?: EntityId
  tenantName?: string
}

export const HANDOVER_STATUSES = ['open', 'accepted', 'resolved'] as const
/**
 * `open`: waiting for a person (possibly assigned to one who has not accepted it yet); `accepted`: a person has
 * taken the conversation over; `resolved`: done.
 */
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number]

export const HANDOVER_REQUESTERS = ['agent', 'member'] as const
/** Who asked for a person: the company's AI agent, or a member of staff who took the conversation over. */
export type HandoverRequester = (typeof HANDOVER_REQUESTERS)[number]

/** A request for a person to take over a WhatsApp conversation. At most one per conversation is unresolved. */
export interface WhatsAppHandover extends CompanyScoped {
  conversationId: EntityId
  status: HandoverStatus
  reason: string
  requestedBy: HandoverRequester
  requestedByUserId?: EntityId
  /** The member who handles it (assigned, or who accepted it). */
  assignedUserId?: EntityId
  assignedUserName?: string
  acceptedAt?: ISODateTime
  resolvedAt?: ISODateTime
  resolvedByUserId?: EntityId
  resolutionNote?: string
}

/** One WhatsApp thread: a contact writing to one of the company's receiving numbers. */
export interface WhatsAppConversationSummary extends CompanyScoped {
  /** The company's receiving number (whatsapp_phone_numbers id). */
  numberId: EntityId
  /** The receiving number as displayed, e.g. `+27 11 555 0100`. */
  companyNumber: string
  contact: WhatsAppConversationContact
  /** The contact's last message; WhatsApp's 24-hour customer service window runs from it. */
  lastInboundAt?: ISODateTime
  lastMessageAt: ISODateTime
  /** The latest message's text, shortened. */
  lastMessagePreview?: string
  /** The conversation's unresolved handover, if any. */
  handover?: WhatsAppHandover
}

/** A conversation with its messages, oldest first. */
export interface WhatsAppConversation extends WhatsAppConversationSummary {
  messages: Communication[]
  /**
   * What the company's AI agent did with the conversation's messages (ticket 10), oldest first. Each run's suggested
   * reply is internal: shown to staff, never sent.
   */
  agentRuns?: WhatsAppAgentRun[]
}
