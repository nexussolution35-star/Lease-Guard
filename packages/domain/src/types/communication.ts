import type { CompanyScoped, EntityId, ISODateTime, StoredFile } from './common.js'

export const CHANNELS = ['whatsapp', 'email', 'system'] as const
export type Channel = (typeof CHANNELS)[number]

export const MESSAGE_DIRECTIONS = ['outbound', 'inbound'] as const
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number]

/**
 * The counterparty of a message. `contact`: a WhatsApp contact who is neither a tenant nor a property owner of
 * the company (inbound only until replies to contacts exist).
 */
export const RECIPIENT_TYPES = ['tenant', 'property_owner', 'contact'] as const
export type RecipientType = (typeof RECIPIENT_TYPES)[number]

/** Tenant-facing types are restricted to statements and payment reminders by product rule. */
export const TENANT_MESSAGE_TYPES = [
  'monthly_statement',
  'initial_payment_reminder',
  'overdue_payment_reminder',
  'follow_up_payment_reminder',
  'arrangement_installment_reminder',
] as const
export type TenantMessageType = (typeof TENANT_MESSAGE_TYPES)[number]

export const OWNER_MESSAGE_TYPES = ['owner_weekly_summary', 'owner_query_response'] as const
export type OwnerMessageType = (typeof OWNER_MESSAGE_TYPES)[number]

export const MESSAGE_TYPES = [
  ...TENANT_MESSAGE_TYPES,
  ...OWNER_MESSAGE_TYPES,
  'inbound_reply',
  'manual',
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export const DELIVERY_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'rejected',
  'received',
] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export interface Communication extends CompanyScoped {
  channel: Channel
  direction: MessageDirection
  messageType: MessageType
  recipientType: RecipientType
  tenantId?: EntityId
  /** Property owner user, for owner messages. */
  ownerUserId?: EntityId
  propertyId?: EntityId
  leaseId?: EntityId
  statementId?: EntityId
  arrangementId?: EntityId
  templateId?: EntityId
  /**
   * Counterparty number (tenant, owner or contact). Always set on outbound messages; absent on an inbound
   * message whose sender WhatsApp identified by a business-scoped user id only.
   */
  counterpartyNumber?: string
  /** The WhatsApp contact (inbound messages, ticket 05). */
  contactId?: EntityId
  /** The WhatsApp conversation the message belongs to. */
  conversationId?: EntityId
  /** When the sender sent an inbound message. */
  receivedAt?: ISODateTime
  /** The company's own WhatsApp Business number this message used. */
  companyNumber: string
  body: string
  attachment?: StoredFile
  status: DeliveryStatus
  approvalId?: EntityId
  externalMessageId?: string
  createdByUserId?: EntityId
  sentAt?: ISODateTime
  deliveredAt?: ISODateTime
  readAt?: ISODateTime
  failureReason?: string
}

export const TEMPLATE_APPROVAL_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const
export type TemplateApprovalStatus = (typeof TEMPLATE_APPROVAL_STATUSES)[number]

export interface MessageTemplate extends CompanyScoped {
  name: string
  messageType: MessageType
  audience: RecipientType
  /** Name registered with Meta. */
  metaTemplateName: string
  language: 'en' | 'en_ZA' | 'af'
  category: 'utility' | 'marketing'
  /** Body with numbered placeholders `{{1}}`, `{{2}}`… */
  body: string
  /** Human names for each placeholder in order. */
  variables: readonly string[]
  approvalStatus: TemplateApprovalStatus
  supportsDocumentAttachment: boolean
}

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected'] as const
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number]

export interface MessageApproval extends CompanyScoped {
  communicationId: EntityId
  requestedByUserId: EntityId
  requestedAt: ISODateTime
  decision: ApprovalDecision
  decidedByUserId?: EntityId
  decidedAt?: ISODateTime
  reason?: string
}
