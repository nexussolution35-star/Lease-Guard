import type { AgentRunOutcome, EntityId } from '@leaseguard/domain'
import { AGENT_RUN_OUTCOMES } from '@leaseguard/domain'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../infrastructure/database/database.types'
import { loadAgentKnowledge } from './agent-knowledge'
import type { AgentHistoryMessage } from './agent-llm'
import { AGENT_HISTORY_LIMIT } from './agent-prompt'
import type { AgentRunCompletion, AgentRunContext, AgentRunRecord, AgentRunRef, AgentRunStart, AgentRunStore } from './agent-runtime'
import { MessagingReadError, readOrThrow } from './read-error'

// The same type as the API's and the worker's DbClient, spelled out so the module depends only on the schema types (as
// communication-lifecycle.ts), which lets the integration tests drive it against local Postgres.
type DbClient = SupabaseClient<Database>

/**
 * The agent runtime's database side, through the worker's service-role client. Every read names the company: the run
 * never loads another company's rows. Runs start and complete through start_/complete_whatsapp_agent_run
 * (20261111100100), which make each step atomic and once-only; the knowledge comes from whatsapp_agent_knowledge,
 * which returns only that company's approved items.
 */
export class DatabaseAgentRunStore implements AgentRunStore {
  constructor(private readonly db: DbClient) {}

  async start(ref: AgentRunRef): Promise<AgentRunStart> {
    const result = await this.db.rpc('start_whatsapp_agent_run', { p_company_id: ref.companyId, p_communication_id: ref.communicationId })
    const row = readOrThrow(result, 'Start the agent run', [])[0]
    switch (row?.outcome) {
      case 'started':
      case 'running':
        return { outcome: row.outcome, runId: row.run_id, conversationId: row.conversation_id }
      case 'completed':
        return {
          outcome: 'completed',
          runId: row.run_id,
          conversationId: row.conversation_id,
          ...(row.reply_communication_id ? { replyCommunicationId: row.reply_communication_id } : {}),
        }
      case 'not_found':
        return { outcome: 'not_found' }
      default:
        throw new MessagingReadError('Start the agent run', { code: 'unexpected_outcome', message: `the database answered ${JSON.stringify(row?.outcome)}` })
    }
  }

  async context(ref: AgentRunRef, conversationId: EntityId): Promise<AgentRunContext | null> {
    const { companyId } = ref
    const [inboundResult, conversationResult, handoverResult] = await Promise.all([
      this.db
        .from('communications')
        .select('id, body, recipient_type, created_at, contact_id')
        .eq('company_id', companyId)
        .eq('id', ref.communicationId)
        .maybeSingle(),
      this.db.from('whatsapp_conversations').select('id, contact_id, last_inbound_at').eq('company_id', companyId).eq('id', conversationId).maybeSingle(),
      this.db.from('whatsapp_handovers').select('id').eq('company_id', companyId).eq('conversation_id', conversationId).neq('status', 'resolved').limit(1),
    ])
    const inbound = readOrThrow(inboundResult, 'Load the inbound message', null)
    const conversation = readOrThrow(conversationResult, 'Load the conversation', null)
    const handovers = readOrThrow(handoverResult, 'Load the conversation handover', [])
    if (!inbound || !conversation) return null

    const [contactResult, historyResult, knowledge] = await Promise.all([
      this.db.from('whatsapp_contacts').select('id, wa_id, tenant_id').eq('company_id', companyId).eq('id', conversation.contact_id).maybeSingle(),
      this.db
        .from('communications')
        .select('id, direction, status, body')
        .eq('company_id', companyId)
        .eq('conversation_id', conversationId)
        .neq('id', inbound.id)
        .lte('created_at', inbound.created_at)
        .order('created_at', { ascending: false })
        .limit(AGENT_HISTORY_LIMIT),
      loadAgentKnowledge(this.db, companyId),
    ])
    const contact = readOrThrow(contactResult, 'Load the conversation contact', null)
    const history = readOrThrow(historyResult, 'Load the conversation messages', [])
    // A tenant by the contact's link, by the message's own recipient, or by a tenant of the company with the number
    // (the same cautious rule as the outbound gate and private.whatsapp_contact_tenant_id).
    const numberTenant = contact?.wa_id ? await this.tenantWithNumber(companyId, `+${contact.wa_id}`) : false
    const isTenant = inbound.recipient_type === 'tenant' || Boolean(contact?.tenant_id) || numberTenant || !contact

    return {
      inboundText: inbound.body,
      sender: isTenant ? 'tenant' : 'contact',
      contactHasNumber: Boolean(contact?.wa_id),
      ...(conversation.last_inbound_at ? { lastInboundAt: conversation.last_inbound_at } : {}),
      humanHandling: handovers.length > 0,
      history: history
        .filter((m) => m.direction === 'inbound' || ['approved', 'queued', 'sent', 'delivered', 'read'].includes(m.status))
        .reverse()
        .map((m): AgentHistoryMessage => ({ from: m.direction === 'inbound' ? 'contact' : 'business', text: m.body })),
      knowledge,
    }
  }

  async complete(companyId: EntityId, runId: EntityId, record: AgentRunRecord): Promise<AgentRunCompletion> {
    // The generated types mark every argument required; the function accepts null for each optional one.
    const none = null as unknown as string
    const noNumber = null as unknown as number
    const result = await this.db.rpc('complete_whatsapp_agent_run', {
      p_company_id: companyId,
      p_run_id: runId,
      p_outcome: record.outcome,
      p_category: record.category ?? none,
      p_confidence: record.confidence ?? noNumber,
      p_handover_reason: record.handoverReason ?? none,
      p_suggested_reply: record.suggestedReply ?? none,
      p_reply_text: record.replyText ?? none,
      p_out_of_hours_since: record.outOfHoursSince ?? none,
      p_model: record.model ?? none,
      p_stop_reason: record.stopReason ?? none,
      p_input_tokens: record.usage?.inputTokens ?? noNumber,
      p_output_tokens: record.usage?.outputTokens ?? noNumber,
      p_cache_read_input_tokens: record.usage?.cacheReadInputTokens ?? noNumber,
      p_cache_creation_input_tokens: record.usage?.cacheCreationInputTokens ?? noNumber,
      p_latency_ms: record.latencyMs === undefined ? noNumber : Math.round(record.latencyMs),
      p_error_message: record.errorMessage ?? none,
    })
    const row = readOrThrow(result, 'Complete the agent run', [])[0]
    if (row?.outcome === 'not_found') return { outcome: 'not_found' }
    if ((row?.outcome !== 'completed' && row?.outcome !== 'already_completed') || !AGENT_RUN_OUTCOMES.includes(row.run_outcome as AgentRunOutcome)) {
      throw new MessagingReadError('Complete the agent run', { code: 'unexpected_outcome', message: `the database answered ${JSON.stringify(row)}` })
    }
    return {
      outcome: row.outcome,
      runOutcome: row.run_outcome as AgentRunOutcome,
      notified: row.notified ?? 0,
      ...(row.reply_communication_id ? { replyCommunicationId: row.reply_communication_id } : {}),
      ...(row.handover_id ? { handoverId: row.handover_id } : {}),
    }
  }

  private async tenantWithNumber(companyId: EntityId, whatsappNumber: string): Promise<boolean> {
    const result = await this.db.from('tenants').select('id').eq('company_id', companyId).eq('whatsapp_number', whatsappNumber).limit(1)
    return readOrThrow(result, 'Load tenants with the contact number', []).length > 0
  }
}
