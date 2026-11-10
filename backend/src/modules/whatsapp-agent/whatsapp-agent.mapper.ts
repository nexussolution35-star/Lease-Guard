import {
  type AgentLanguage,
  type AgentOperatingPeriod,
  type AgentPermittedAction,
  DEFAULT_AGENT_TIMEZONE,
  type EntityId,
  type KnowledgeDocument,
  type KnowledgeDocumentMimeType,
  type KnowledgeEntry,
  type KnowledgeFaq,
  type KnowledgeReview,
  type KnowledgeStatus,
  type WhatsAppAgentConfig,
} from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'
import type { MemberNames } from '../whatsapp-conversations/whatsapp-conversations.mapper'
import type { SaveAgentConfigBody } from './whatsapp-agent.schemas'

export type AgentConfigRow = Tables<'whatsapp_agent_configs'>
export type FaqRow = Tables<'whatsapp_knowledge_faqs'>
export type EntryRow = Tables<'whatsapp_knowledge_entries'>
export type DocumentRow = Tables<'whatsapp_knowledge_documents'>

/** The configuration a company has before an admin saves one: nothing permitted, auto-reply off. */
export function defaultAgentConfig(companyId: EntityId): WhatsAppAgentConfig {
  return {
    companyId,
    configured: false,
    agentName: '',
    businessDescription: '',
    tone: '',
    timezone: DEFAULT_AGENT_TIMEZONE,
    operatingHours: [],
    languages: ['en'],
    policies: '',
    supportInstructions: '',
    escalationRules: '',
    permittedActions: [],
    autoReplyEnabled: false,
    handoverContacts: [],
  }
}

/** Database row (or none) and handover contacts → domain `WhatsAppAgentConfig`. */
export function toAgentConfig(
  companyId: EntityId,
  row: AgentConfigRow | null,
  handoverContactIds: readonly EntityId[],
  names: MemberNames,
): WhatsAppAgentConfig {
  const handoverContacts = handoverContactIds.map((userId) => {
    const name = names.get(userId)
    return { userId, ...(name ? { name } : {}) }
  })
  if (!row) return { ...defaultAgentConfig(companyId), handoverContacts }
  return {
    companyId: row.company_id,
    configured: true,
    agentName: row.agent_name,
    businessDescription: row.business_description,
    tone: row.tone,
    timezone: row.timezone,
    // The database checks the shape (private.is_agent_operating_hours).
    operatingHours: row.operating_hours as unknown as AgentOperatingPeriod[],
    languages: row.languages as AgentLanguage[],
    policies: row.policies,
    supportInstructions: row.support_instructions,
    escalationRules: row.escalation_rules,
    permittedActions: row.permitted_actions as AgentPermittedAction[],
    autoReplyEnabled: row.auto_reply_enabled,
    ...(row.out_of_hours_message ? { outOfHoursMessage: row.out_of_hours_message } : {}),
    handoverContacts,
    updatedAt: row.updated_at,
    ...(row.updated_by_user_id ? { updatedByUserId: row.updated_by_user_id } : {}),
  }
}

/** The body of PUT /whatsapp/agent → the `p_config` of save_whatsapp_agent_config (snake_case columns). */
export function toConfigRecord(body: SaveAgentConfigBody): Record<string, unknown> {
  return {
    agent_name: body.agentName,
    business_description: body.businessDescription,
    tone: body.tone,
    timezone: body.timezone,
    operating_hours: body.operatingHours,
    languages: [...new Set(body.languages)],
    policies: body.policies,
    support_instructions: body.supportInstructions,
    escalation_rules: body.escalationRules,
    permitted_actions: [...new Set(body.permittedActions)],
    auto_reply_enabled: body.autoReplyEnabled,
    out_of_hours_message: body.outOfHoursMessage ? body.outOfHoursMessage : null,
  }
}

type ReviewColumns = Pick<FaqRow, 'id' | 'company_id' | 'status' | 'approved_at' | 'approved_by_user_id' | 'created_by_user_id' | 'created_at' | 'updated_at'>

function toReview(row: ReviewColumns, names: MemberNames): KnowledgeReview & { id: EntityId; companyId: EntityId; createdAt: string; updatedAt: string } {
  const approvedByName = row.approved_by_user_id ? names.get(row.approved_by_user_id) : undefined
  return {
    id: row.id,
    companyId: row.company_id,
    status: row.status as KnowledgeStatus,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.approved_by_user_id ? { approvedByUserId: row.approved_by_user_id } : {}),
    ...(approvedByName ? { approvedByName } : {}),
    ...(row.created_by_user_id ? { createdByUserId: row.created_by_user_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toFaq(row: FaqRow, names: MemberNames = new Map()): KnowledgeFaq {
  return { ...toReview(row, names), question: row.question, answer: row.answer }
}

export function toEntry(row: EntryRow, names: MemberNames = new Map()): KnowledgeEntry {
  return { ...toReview(row, names), title: row.title, content: row.content }
}

/** The storage path stays on the server: the browser asks for a short-lived download link instead. */
export function toDocument(row: DocumentRow, names: MemberNames = new Map()): KnowledgeDocument {
  return {
    ...toReview(row, names),
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    fileName: row.file_name,
    mimeType: row.mime_type as KnowledgeDocumentMimeType,
    sizeBytes: row.size_bytes,
  }
}

/** The approvers whose names a list shows. */
export function approverIds(rows: readonly Pick<FaqRow, 'approved_by_user_id'>[]): EntityId[] {
  return [...new Set(rows.flatMap((row) => (row.approved_by_user_id ? [row.approved_by_user_id] : [])))]
}
