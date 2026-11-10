import type { EntityId, WhatsAppConversation, WhatsAppConversationSummary } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'

export type { WhatsAppConversation, WhatsAppConversationSummary }

export interface ConversationListParams {
  page: number
  pageSize: number
}

/** The active company's WhatsApp inbox (read-only). */
export interface ConversationSource {
  /** Most recent conversation first. */
  list(companyId: EntityId, params: ConversationListParams): Promise<Page<WhatsAppConversationSummary>>
  /** Null when the conversation does not exist in the company. */
  get(companyId: EntityId, conversationId: EntityId): Promise<WhatsAppConversation | null>
}
