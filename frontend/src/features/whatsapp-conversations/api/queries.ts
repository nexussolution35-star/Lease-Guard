import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { Communication, EntityId } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import { getConversationSource } from './selectSource'
import type { ConversationListParams, ConversationSource, WhatsAppConversation, WhatsAppConversationSummary, WhatsAppHandover } from './source'

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

/** The active company id for a mutation; mutations only run from screens inside an open workspace. */
function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/** A conversation action that refreshes the inbox and the open conversation afterwards. */
function useConversationMutation<TVariables, TResult>(
  run: (source: ConversationSource, companyId: EntityId, variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(getConversationSource(), companyId(), variables),
    onSettled: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  })
}

/** Company writers: take a conversation over. */
export function useAcceptHandover(): UseMutationResult<WhatsAppHandover, Error, { conversationId: EntityId }> {
  return useConversationMutation((source, companyId, { conversationId }: { conversationId: EntityId }) => source.acceptHandover(companyId, conversationId))
}

/** Company writers: hand a conversation to a colleague (or to themselves). */
export function useAssignHandover(): UseMutationResult<WhatsAppHandover, Error, { conversationId: EntityId; userId: EntityId }> {
  return useConversationMutation((source, companyId, { conversationId, userId }: { conversationId: EntityId; userId: EntityId }) =>
    source.assignHandover(companyId, conversationId, userId),
  )
}

/** Company writers: resolve a conversation's handover. */
export function useResolveHandover(): UseMutationResult<WhatsAppHandover, Error, { conversationId: EntityId; note?: string }> {
  return useConversationMutation((source, companyId, { conversationId, note }: { conversationId: EntityId; note?: string }) =>
    source.resolveHandover(companyId, conversationId, note),
  )
}

/** Company writers: reply to the contact of a conversation; the reply is queued for delivery. */
export function useReplyToContact(): UseMutationResult<Communication, Error, { conversationId: EntityId; body: string }> {
  return useConversationMutation((source, companyId, { conversationId, body }: { conversationId: EntityId; body: string }) =>
    source.reply(companyId, conversationId, body),
  )
}
