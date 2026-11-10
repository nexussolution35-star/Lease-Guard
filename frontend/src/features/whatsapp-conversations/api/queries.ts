import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getConversationSource } from './selectSource'
import type { ConversationListParams, WhatsAppConversation, WhatsAppConversationSummary } from './source'

export const conversationKeys = createEntityKeys('whatsapp-conversations')

/** New messages arrive through Meta's webhook; the open inbox refreshes on this interval. */
export const INBOX_REFRESH_MS = 15_000

export function useConversationList(params: ConversationListParams): UseQueryResult<Page<WhatsAppConversationSummary>> {
  return useCompanyQuery(
    (companyId) => conversationKeys.list(companyId, params),
    (companyId) => getConversationSource().list(companyId, params),
    { keepPrevious: true, refetchInterval: INBOX_REFRESH_MS },
  )
}

/** Data is null when the conversation does not exist in the active workspace. */
export function useConversation(id: EntityId | undefined): UseQueryResult<WhatsAppConversation | null> {
  return useCompanyQuery(
    (companyId) => conversationKeys.detail(companyId, id ?? ''),
    (companyId) => getConversationSource().get(companyId, id ?? ''),
    { enabled: id !== undefined, refetchInterval: INBOX_REFRESH_MS },
  )
}
