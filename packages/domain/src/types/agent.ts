import type { CompanyScoped, EntityId, ISODateTime } from './common.js'
import type { Weekday } from './company.js'

/**
 * Each company's AI agent and knowledge base (ticket 09). The agent answers contacts' frequently asked questions from
 * the company's APPROVED knowledge only (ticket 10). Tenants are never answered automatically, whatever the
 * configuration says: a tenant's message gets at most an internal suggested reply and a handover to a person.
 */

/**
 * What the agent may do. `draft_tenant_reply` only drafts an internal suggestion for staff; nothing is ever sent to
 * a tenant automatically.
 */
export const AGENT_PERMITTED_ACTIONS = [
  'answer_faq',
  'share_business_info',
  'share_approved_document',
  'capture_enquiry',
  'draft_tenant_reply',
] as const
export type AgentPermittedAction = (typeof AGENT_PERMITTED_ACTIONS)[number]

/** The South African languages the agent can be told to use (ISO 639 codes). */
export const AGENT_LANGUAGES = ['en', 'af', 'zu', 'xh', 'st', 'tn', 'nso', 'ts', 'ss', 've', 'nr'] as const
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number]

/** The agent's operating hours default to South African time. */
export const DEFAULT_AGENT_TIMEZONE = 'Africa/Johannesburg'

/** One opening period on a weekday, `HH:mm` in the agent's timezone; `closes` may be `24:00`. */
export interface AgentOperatingPeriod {
  day: Weekday
  opens: string
  closes: string
}

/** A member told when the agent hands a conversation to a person (an active company admin or property manager). */
export interface AgentHandoverContact {
  userId: EntityId
  name?: string
}

/** The company's AI agent settings. Every company has one; `configured` is false until an admin saves it. */
export interface WhatsAppAgentConfig {
  companyId: EntityId
  configured: boolean
  agentName: string
  businessDescription: string
  tone: string
  timezone: string
  /** Empty: never open, so the out-of-hours message applies at all times. */
  operatingHours: AgentOperatingPeriod[]
  languages: AgentLanguage[]
  policies: string
  supportInstructions: string
  escalationRules: string
  permittedActions: AgentPermittedAction[]
  /** Whether the agent may answer contacts (never tenants) on its own. Off until an admin turns it on. */
  autoReplyEnabled: boolean
  outOfHoursMessage?: string
  handoverContacts: AgentHandoverContact[]
  updatedAt?: ISODateTime
  updatedByUserId?: EntityId
}

/** What a company admin saves (the whole configuration). */
export type WhatsAppAgentConfigInput = Omit<WhatsAppAgentConfig, 'companyId' | 'configured' | 'handoverContacts' | 'updatedAt' | 'updatedByUserId' | 'outOfHoursMessage'> & {
  outOfHoursMessage?: string | undefined
  handoverContactUserIds: EntityId[]
}

export const KNOWLEDGE_STATUSES = ['draft', 'approved'] as const
/** `draft`: not available to the agent; `approved`: a company admin approved it, so the agent may use it. */
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number]

/** Draft or approved, with who approved it and when. */
export interface KnowledgeReview {
  status: KnowledgeStatus
  approvedAt?: ISODateTime
  approvedByUserId?: EntityId
  approvedByName?: string
  createdByUserId?: EntityId
}

export interface KnowledgeFaq extends CompanyScoped, KnowledgeReview {
  question: string
  answer: string
}

export interface KnowledgeEntry extends CompanyScoped, KnowledgeReview {
  title: string
  content: string
}

export const KNOWLEDGE_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'] as const
export type KnowledgeDocumentMimeType = (typeof KNOWLEDGE_DOCUMENT_MIME_TYPES)[number]
/** Largest knowledge document: 10 MB (the agent-knowledge bucket's limit). */
export const KNOWLEDGE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export interface KnowledgeDocument extends CompanyScoped, KnowledgeReview {
  title: string
  description?: string
  fileName: string
  mimeType: KnowledgeDocumentMimeType
  sizeBytes: number
}
