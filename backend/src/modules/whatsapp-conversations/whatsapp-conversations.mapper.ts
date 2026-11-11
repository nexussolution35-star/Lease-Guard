import type {
  AgentMessageCategory,
  AgentRunOutcome,
  EntityId,
  HandoverRequester,
  HandoverStatus,
  WhatsAppAgentRun,
  WhatsAppConversationContact,
  WhatsAppConversationSummary,
  WhatsAppHandover,
} from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

const PREVIEW_LENGTH = 140

/** The conversation columns and embeds the inbox reads (see CONVERSATION_SELECT). */
export type ConversationRow = Pick<Tables<'whatsapp_conversations'>, 'id' | 'company_id' | 'number_id' | 'last_inbound_at' | 'last_message_at' | 'created_at' | 'updated_at'> & {
  contact:
    | (Pick<Tables<'whatsapp_contacts'>, 'id' | 'profile_name' | 'wa_id' | 'tenant_id'> & {
        tenant: Pick<Tables<'tenants'>, 'trading_name' | 'legal_name'> | null
      })
    | null
  number: Pick<Tables<'whatsapp_phone_numbers'>, 'display_number' | 'phone_number_id'> | null
  messages?: Pick<Tables<'communications'>, 'body'>[]
  /** The unresolved handover (at most one; the select filters out resolved ones). */
  handovers?: HandoverRow[]
}

export type HandoverRow = Tables<'whatsapp_handovers'>

/** Every handover column; members read them all. */
export const HANDOVER_COLUMNS =
  'id, company_id, conversation_id, status, reason, requested_by, requested_by_user_id, assigned_user_id, accepted_at, ' +
  'resolved_at, resolved_by_user_id, resolution_note, created_at, updated_at'

/** The conversation's handovers embed (filter it to unresolved ones with `.neq('handovers.status', 'resolved')`). */
export const HANDOVERS_EMBED = `handovers:whatsapp_handovers!whatsapp_handovers_conversation_fk(${HANDOVER_COLUMNS})`

/** Member names by user id, for the assignee (profiles are readable by colleagues). */
export type MemberNames = ReadonlyMap<EntityId, string>

/** Database row → domain `WhatsAppHandover`. */
export function toHandover(row: HandoverRow, names: MemberNames = new Map()): WhatsAppHandover {
  const assignedUserName = row.assigned_user_id ? names.get(row.assigned_user_id) : undefined
  return {
    id: row.id,
    companyId: row.company_id,
    conversationId: row.conversation_id,
    status: row.status as HandoverStatus,
    reason: row.reason,
    requestedBy: row.requested_by as HandoverRequester,
    ...(row.requested_by_user_id ? { requestedByUserId: row.requested_by_user_id } : {}),
    ...(row.assigned_user_id ? { assignedUserId: row.assigned_user_id } : {}),
    ...(assignedUserName ? { assignedUserName } : {}),
    ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    ...(row.resolved_by_user_id ? { resolvedByUserId: row.resolved_by_user_id } : {}),
    ...(row.resolution_note ? { resolutionNote: row.resolution_note } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The user ids whose names a list of handovers shows. */
export function assigneeIds(rows: readonly (HandoverRow | undefined)[]): EntityId[] {
  return [...new Set(rows.flatMap((row) => (row?.assigned_user_id ? [row.assigned_user_id] : [])))]
}

/**
 * The columns and embeds of a conversation. Composite foreign keys keep every embed inside the conversation's
 * own company; the number's credential reference is never selected (members cannot read it).
 */
export const CONVERSATION_SELECT =
  'id, company_id, number_id, last_inbound_at, last_message_at, created_at, updated_at, ' +
  'contact:whatsapp_contacts!whatsapp_conversations_contact_fk(id, profile_name, wa_id, tenant_id, tenant:tenants!whatsapp_contacts_tenant_fk(trading_name, legal_name)), ' +
  'number:whatsapp_phone_numbers!whatsapp_conversations_number_fk(display_number, phone_number_id)'

function toContact(row: ConversationRow): WhatsAppConversationContact {
  const contact = row.contact
  // contact_id is NOT NULL with a same-company foreign key, and members read their company's contacts.
  if (!contact) throw new Error(`Conversation ${row.id} has no readable contact`)
  const tenantName = contact.tenant ? contact.tenant.trading_name || contact.tenant.legal_name : undefined
  return {
    id: contact.id,
    ...(contact.profile_name ? { profileName: contact.profile_name } : {}),
    ...(contact.wa_id ? { phoneNumber: `+${contact.wa_id}` } : {}),
    ...(contact.tenant_id ? { tenantId: contact.tenant_id } : {}),
    ...(tenantName ? { tenantName } : {}),
  }
}

function preview(body: string | undefined): string | undefined {
  if (!body) return undefined
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

/** Database row → domain `WhatsAppConversationSummary`. */
export function toConversationSummary(row: ConversationRow, names: MemberNames = new Map()): WhatsAppConversationSummary {
  const lastPreview = preview(row.messages?.[0]?.body)
  const handover = row.handovers?.find((h) => h.status !== 'resolved')
  return {
    id: row.id,
    companyId: row.company_id,
    numberId: row.number_id,
    companyNumber: row.number?.display_number || row.number?.phone_number_id || '',
    contact: toContact(row),
    ...(row.last_inbound_at ? { lastInboundAt: row.last_inbound_at } : {}),
    lastMessageAt: row.last_message_at,
    ...(lastPreview ? { lastMessagePreview: lastPreview } : {}),
    ...(handover ? { handover: toHandover(handover, names) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type AgentRunRow = Tables<'whatsapp_agent_runs'>

/** Every agent run column but the safe error text, which only the worker's logs need. */
export const AGENT_RUN_COLUMNS =
  'id, company_id, conversation_id, communication_id, status, outcome, category, confidence, handover_reason, suggested_reply, ' +
  'reply_communication_id, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, latency_ms, ' +
  'completed_at, created_at, updated_at'

/** Database row → domain `WhatsAppAgentRun`. */
export function toAgentRun(row: Omit<AgentRunRow, 'error_message' | 'handover_id' | 'stop_reason'>): WhatsAppAgentRun {
  const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } => (value === null ? {} : ({ [key]: value } as { [P in K]: V }))
  return {
    id: row.id,
    companyId: row.company_id,
    conversationId: row.conversation_id,
    communicationId: row.communication_id,
    status: row.status === 'completed' ? 'completed' : 'started',
    ...optional('outcome', row.outcome as AgentRunOutcome | null),
    ...optional('category', row.category as AgentMessageCategory | null),
    ...optional('confidence', row.confidence === null ? null : Number(row.confidence)),
    ...optional('handoverReason', row.handover_reason),
    ...optional('suggestedReply', row.suggested_reply),
    ...optional('replyCommunicationId', row.reply_communication_id),
    ...optional('model', row.model),
    ...optional('inputTokens', row.input_tokens),
    ...optional('outputTokens', row.output_tokens),
    ...optional('cacheReadInputTokens', row.cache_read_input_tokens),
    ...optional('cacheCreationInputTokens', row.cache_creation_input_tokens),
    ...optional('latencyMs', row.latency_ms),
    ...optional('completedAt', row.completed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
