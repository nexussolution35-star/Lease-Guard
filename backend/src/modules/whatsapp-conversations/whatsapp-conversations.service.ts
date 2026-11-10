import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, WhatsAppConversation, WhatsAppConversationSummary } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toCommunication } from '../communications/communications.mapper'
import { CONVERSATION_SELECT, type ConversationRow, toConversationSummary } from './whatsapp-conversations.mapper'
import { type ConversationListQuery, THREAD_MESSAGE_LIMIT } from './whatsapp-conversations.schemas'

/**
 * The active company's WhatsApp inbox, read-only (ticket 05): conversations, most recent first, and each
 * conversation's messages. Every query names the company explicitly; Row Level Security enforces the same, so a
 * conversation of another company is simply not found.
 */
@Injectable()
export class WhatsAppConversationsService {
  async list(db: DbClient, companyId: EntityId, query: ConversationListQuery): Promise<Page<WhatsAppConversationSummary>> {
    const filtered = () => {
      let request = db
        .from('whatsapp_conversations')
        .select(`${CONVERSATION_SELECT}, messages:communications!communications_conversation_fk(body, created_at)`, { count: 'exact' })
        .eq('company_id', companyId)
      if (query.numberId) request = request.eq('number_id', query.numberId)
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
    return toPage(data as unknown as ConversationRow[] | null, count, query, toConversationSummary)
  }

  async get(db: DbClient, companyId: EntityId, conversationId: EntityId): Promise<WhatsAppConversation> {
    const [conversation, messages] = await Promise.all([
      db.from('whatsapp_conversations').select(CONVERSATION_SELECT).eq('company_id', companyId).eq('id', conversationId).maybeSingle(),
      db
        .from('communications')
        .select('*')
        .eq('company_id', companyId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(THREAD_MESSAGE_LIMIT),
    ])
    if (conversation.error) throw httpErrorFromDatabase(conversation.error, 'Get WhatsApp conversation')
    if (!conversation.data) throw new NotFoundException('Conversation not found')
    if (messages.error) throw httpErrorFromDatabase(messages.error, 'List conversation messages')
    const row = conversation.data as unknown as ConversationRow
    const thread = (messages.data ?? []).slice().reverse().map((message) => toCommunication(message))
    return {
      ...toConversationSummary({ ...row, messages: thread.length > 0 ? [{ body: thread[thread.length - 1]!.body }] : [] }),
      messages: thread,
    }
  }
}
