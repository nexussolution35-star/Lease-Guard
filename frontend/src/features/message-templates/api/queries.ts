import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, MessageTemplateSettings, MessageTypeTemplate, TemplatedMessageType } from '@leaseguard/domain'

import { whatsAppTemplateKeys } from '@/features/whatsapp-integration/api/queries'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import { getMessageTemplateSource } from './selectSource'
import type { MessageTemplateSyncRequest } from './source'

export const messageTemplateKeys = createEntityKeys('message-template-settings')

/** How often the settings are read again while a sync requested from this page may still be running. */
export const SYNC_POLL_MS = 3000

/** Every templated message type of the active company with the template that sends it. */
export function useMessageTemplateSettings(options: { polling?: boolean } = {}): UseQueryResult<MessageTemplateSettings> {
  return useCompanyQuery(
    (companyId) => messageTemplateKeys.company(companyId),
    (companyId) => getMessageTemplateSource().getSettings(companyId),
    { refetchInterval: () => (options.polling ? SYNC_POLL_MS : false) },
  )
}

/** Company admins: choose the synced Meta template that sends a message type. */
export function useChooseMessageTemplate(): UseMutationResult<
  MessageTypeTemplate,
  Error,
  { messageType: TemplatedMessageType; whatsappTemplateId: EntityId }
> {
  const companyId = useActiveCompanyId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ messageType, whatsappTemplateId }) => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return getMessageTemplateSource().choose(companyId, messageType, whatsappTemplateId)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all }),
  })
}

/** Company admins: sync the templates from Meta again; the settings and the synced templates are read again. */
export function useSyncMessageTemplates(): UseMutationResult<MessageTemplateSyncRequest, Error, void> {
  const companyId = useActiveCompanyId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return getMessageTemplateSource().sync(companyId)
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all }),
        queryClient.invalidateQueries({ queryKey: whatsAppTemplateKeys.all }),
      ]),
  })
}
