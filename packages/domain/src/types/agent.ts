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

/**
 * What the agent decides about one inbound message (ticket 10). The model proposes; the agent policy
 * (rules/agentPolicy.ts) decides what actually happens, so the business controls what the AI can say.
 */
export const AGENT_ACTIONS = ['reply', 'handover', 'ignore'] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]

export const AGENT_MESSAGE_CATEGORIES = [
  'faq',
  'business_info',
  'document_request',
  'complaint',
  'payment_or_arrangement',
  'dispute',
  'lease_question',
  'other',
] as const
export type AgentMessageCategory = (typeof AGENT_MESSAGE_CATEGORIES)[number]

export interface AgentDecision {
  action: AgentAction
  /** The reply the model proposes (to send, or as an internal suggestion for staff). */
  replyText?: string
  handoverReason?: string
  category: AgentMessageCategory
  /** 0 to 1. */
  confidence: number
}

/**
 * What one agent run did with an inbound message:
 * - `replied`: an answer was sent to a contact;
 * - `out_of_hours`: the out-of-hours message was sent and the conversation handed to a person;
 * - `handed_over`: a person takes it (always for tenants, complaints, payments, disputes, refusals, errors, low confidence);
 * - `ignored`: nothing to answer (e.g. "thank you");
 * - `not_configured`: the company has not set up its agent, so nothing ran.
 */
export const AGENT_RUN_OUTCOMES = ['replied', 'out_of_hours', 'handed_over', 'ignored', 'not_configured'] as const
export type AgentRunOutcome = (typeof AGENT_RUN_OUTCOMES)[number]

/** One agent run, as staff see it in the conversation. The suggested reply is internal: never sent. */
export interface WhatsAppAgentRun extends CompanyScoped {
  conversationId: EntityId
  /** The inbound message the run handled. */
  communicationId: EntityId
  status: 'started' | 'completed'
  outcome?: AgentRunOutcome
  category?: AgentMessageCategory
  confidence?: number
  handoverReason?: string
  /** Internal, for staff only: what the agent would have answered. */
  suggestedReply?: string
  /** The message the agent sent (answer or out-of-hours message). */
  replyCommunicationId?: EntityId
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  latencyMs?: number
  createdAt: ISODateTime
  completedAt?: ISODateTime
}
