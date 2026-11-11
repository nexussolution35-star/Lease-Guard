import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, WhatsAppConversation, WhatsAppConversationSummary } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toCommunication } from '../communications/communications.mapper'
import { memberNames } from './member-names'
import {
  AGENT_RUN_COLUMNS,
  type AgentRunRow,
  assigneeIds,
  CONVERSATION_SELECT,
  type ConversationRow,
  HANDOVER_COLUMNS,
  toAgentRun,
  toConversationSummary,
} from './whatsapp-conversations.mapper'
import { type ConversationListQuery, THREAD_MESSAGE_LIMIT } from './whatsapp-conversations.schemas'

/**
 * The active company's WhatsApp inbox (ticket 05; handovers ticket 07): conversations, most recent first, each with
 * its unresolved handover, and each conversation's messages and AI agent runs (ticket 10). Every query names the company explicitly; Row Level
 * Security enforces the same, so a conversation of another company is simply not found.
 */
@Injectable()
export class WhatsAppConversationsService {
  /** `userId`: the caller, for the `mine` view. */
  async list(db: DbClient, companyId: EntityId, userId: EntityId, query: ConversationListQuery): Promise<Page<WhatsAppConversationSummary>> {
    // A handover view keeps only conversations with an unresolved handover (an inner embed filters the parents).
    const handovers = `handovers:whatsapp_handovers!whatsapp_handovers_conversation_fk${query.filter ? '!inner' : ''}(${HANDOVER_COLUMNS})`
    const filtered = () => {
      let request = db
        .from('whatsapp_conversations')
        .select(`${CONVERSATION_SELECT}, ${handovers}, messages:communications!communications_conversation_fk(body, created_at)`, { count: 'exact' })
        .eq('company_id', companyId)
        .neq('handovers.status', 'resolved')
      if (query.numberId) request = request.eq('number_id', query.numberId)
      if (query.filter === 'mine') request = request.eq('handovers.assigned_user_id', userId)
      return request
    }
    const { data, error, count } = await filtered()
      .order('created_at', { referencedTable: 'messages', ascending: false })
      .limit(1, { referencedTable: 'messages' })
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List WhatsApp conversations')
      throw httpErrorFromDatabase(error, 'List WhatsApp conversations')
    }
    const rows = (data as unknown as ConversationRow[] | null) ?? []
    const names = await memberNames(db, assigneeIds(rows.flatMap((row) => row.handovers ?? [])))
    return toPage(rows, count, query, (row) => toConversationSummary(row, names))
  }

  async get(db: DbClient, companyId: EntityId, conversationId: EntityId): Promise<WhatsAppConversation> {
    const [conversation, messages, runs] = await Promise.all([
      db
        .from('whatsapp_conversations')
        .select(`${CONVERSATION_SELECT}, handovers:whatsapp_handovers!whatsapp_handovers_conversation_fk(${HANDOVER_COLUMNS})`)
        .eq('company_id', companyId)
        .eq('id', conversationId)
        .neq('handovers.status', 'resolved')
        .maybeSingle(),
      db
        .from('communications')
        .select('*')
        .eq('company_id', companyId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(THREAD_MESSAGE_LIMIT),
      db
        .from('whatsapp_agent_runs')
        .select(AGENT_RUN_COLUMNS)
        .eq('company_id', companyId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(THREAD_MESSAGE_LIMIT),
    ])
    if (conversation.error) throw httpErrorFromDatabase(conversation.error, 'Get WhatsApp conversation')
    if (!conversation.data) throw new NotFoundException('Conversation not found')
    if (messages.error) throw httpErrorFromDatabase(messages.error, 'List conversation messages')
    if (runs.error) throw httpErrorFromDatabase(runs.error, "List the AI agent's runs")
    const row = conversation.data as unknown as ConversationRow
    const thread = (messages.data ?? []).slice().reverse().map((message) => toCommunication(message))
    const names = await memberNames(db, assigneeIds(row.handovers ?? []))
    return {
      ...toConversationSummary({ ...row, messages: thread.length > 0 ? [{ body: thread[thread.length - 1]!.body }] : [] }, names),
      messages: thread,
      agentRuns: ((runs.data ?? []) as unknown as AgentRunRow[]).slice().reverse().map(toAgentRun),
    }
  }
}
