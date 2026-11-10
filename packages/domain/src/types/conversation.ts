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
}

/** A conversation with its messages, oldest first. */
export interface WhatsAppConversation extends WhatsAppConversationSummary {
  messages: Communication[]
}
