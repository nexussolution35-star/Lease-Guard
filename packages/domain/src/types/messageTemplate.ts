import type { EntityId, ISODateTime } from './common.js'
import {
  OWNER_MESSAGE_TYPES,
  TENANT_MESSAGE_TYPES,
  type OwnerMessageType,
  type TemplateApprovalStatus,
  type TenantMessageType,
} from './communication.js'

/**
 * The message types LeaseGuard sends with a Meta-approved WhatsApp template (Settings → Message templates): the five
 * tenant statement and payment types, then the owner types. Inbound replies and manual messages use no template.
 */
export const TEMPLATED_MESSAGE_TYPES = [...TENANT_MESSAGE_TYPES, ...OWNER_MESSAGE_TYPES] as const
export type TemplatedMessageType = TenantMessageType | OwnerMessageType

/** Who receives a templated message type. */
export type TemplateAudience = 'tenant' | 'property_owner'

/** Meta's header formats; a `DOCUMENT` header carries the statement PDF. */
export const WHATSAPP_TEMPLATE_HEADER_FORMATS = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'] as const
export type WhatsAppTemplateHeaderFormat = (typeof WHATSAPP_TEMPLATE_HEADER_FORMATS)[number]

/** The Meta template a company admin chose for one message type (a `message_templates` row). */
export interface MessageTypeTemplateMapping {
  /** The company's message template (`message_templates.id`); communications name it. */
  templateId: EntityId
  /** The synced Meta template with the same name and language, while Meta still holds it. */
  whatsappTemplateId?: EntityId
  /** Name registered with Meta. */
  metaTemplateName: string
  /** Meta language code, e.g. `en_ZA`. */
  language: string
  /** `utility` or `marketing`. */
  category: string
  /** The body as mapped, with numbered placeholders `{{1}}`, `{{2}}`… */
  body: string
  /** What each placeholder holds, in order. */
  variables: string[]
  /** LeaseGuard's reading of Meta's status (kept up to date by every sync and Meta's status webhook). */
  approvalStatus: TemplateApprovalStatus
  /** Meta's own status of the synced template, e.g. `APPROVED`, `PAUSED`; absent once Meta no longer holds it. */
  metaStatus?: string
  /** Meta's reason when it rejected or paused the template. */
  rejectedReason?: string
  /** The template has a document header, so it can carry the statement PDF. */
  supportsDocumentAttachment: boolean
  /** Meta's text of the template differs from the text mapped (it was edited in WhatsApp Manager). */
  metaBodyChanged: boolean
  mappedAt: ISODateTime
  /** Who mapped it; absent when the member has left the company. */
  mappedByUserId?: EntityId
  mappedByName?: string
}

/** One message type with the template that sends it. */
export interface MessageTypeTemplate {
  messageType: TemplatedMessageType
  audience: TemplateAudience
  mapping?: MessageTypeTemplateMapping
  /** Messages of this type can be sent now: mapped, approved by Meta and its text unchanged. */
  sendable: boolean
}

/** Settings → Message templates: every templated message type, and whether the company has WhatsApp connected. */
export interface MessageTemplateSettings {
  /** At least one of the company's WhatsApp numbers is connected (verified with Meta). */
  whatsappConnected: boolean
  types: MessageTypeTemplate[]
}

/** A Meta template as the mapping rules judge it (a synced `whatsapp_message_templates` row). */
export interface MappingCandidate {
  name: string
  language: string
  /** Meta's category, e.g. `UTILITY`. */
  category: string
  /** Meta's status, e.g. `APPROVED`. */
  status: string
  /** Meta's body text; absent when it was synced before LeaseGuard read template text. */
  body?: string
  headerFormat?: WhatsAppTemplateHeaderFormat
}
