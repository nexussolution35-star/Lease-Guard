import type { Communication, EntityId, WhatsAppConversation, WhatsAppConversationSummary, WhatsAppHandover } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'

export type { WhatsAppConversation, WhatsAppConversationSummary, WhatsAppHandover }

/** Inbox views besides everything: conversations handed over to a person, or assigned to the signed-in user. */
export const CONVERSATION_FILTERS = ['handed_over', 'mine'] as const
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number]

export interface ConversationListParams {
  page: number
  pageSize: number
  filter?: ConversationFilter
}

/**
 * The active company's WhatsApp inbox. Reading is open to every member; handovers and replies are for company
 * writers (company_admin, property_manager), which the API enforces.
 */
export interface ConversationSource {
  /** Most recent conversation first. */
  list(companyId: EntityId, params: ConversationListParams): Promise<Page<WhatsAppConversationSummary>>
  /** Null when the conversation does not exist in the company. */
  get(companyId: EntityId, conversationId: EntityId): Promise<WhatsAppConversation | null>
  /** Take the conversation over (409 when a colleague already accepted it). */
  acceptHandover(companyId: EntityId, conversationId: EntityId): Promise<WhatsAppHandover>
  /** Hand it to an active company admin or property manager (422 for anyone else). */
  assignHandover(companyId: EntityId, conversationId: EntityId, userId: EntityId): Promise<WhatsAppHandover>
  /** Resolve its handover (409 when it has none). */
  resolveHandover(companyId: EntityId, conversationId: EntityId, note?: string): Promise<WhatsAppHandover>
  /** A free-form reply to the contact (422 with every reason when it may not be sent). */
  reply(companyId: EntityId, conversationId: EntityId, body: string): Promise<Communication>
}
