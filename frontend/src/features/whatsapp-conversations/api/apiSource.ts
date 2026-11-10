import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Communication, WhatsAppConversation, WhatsAppConversationSummary, WhatsAppHandover } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'

import type { ConversationSource } from './source'

/** Conversations from the LeaseGuard API (`/api/v1/whatsapp/conversations…`). */
export function createApiConversationSource(api: ApiClient): ConversationSource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  const path = (conversationId: string) => ({ path: { conversationId } })
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/whatsapp/conversations', {
          params: { query: compactQuery({ page: params.page, pageSize: params.pageSize, filter: params.filter }) },
          headers: scoped(companyId),
        }),
      )
      return { ...page, items: page.items satisfies WhatsAppConversationSummary[] }
    },

    async get(companyId, conversationId) {
      if (!isUuid(conversationId)) return null
      try {
        const conversation: WhatsAppConversation = await unwrap(
          api.GET('/api/v1/whatsapp/conversations/{conversationId}', { params: path(conversationId), headers: scoped(companyId) }),
        )
        return conversation
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    async acceptHandover(companyId, conversationId) {
      const handover: WhatsAppHandover = await unwrap(
        api.POST('/api/v1/whatsapp/conversations/{conversationId}/handover/accept', { params: path(conversationId), headers: scoped(companyId) }),
      )
      return handover
    },

    async assignHandover(companyId, conversationId, userId) {
      const handover: WhatsAppHandover = await unwrap(
        api.POST('/api/v1/whatsapp/conversations/{conversationId}/handover/assign', {
          params: path(conversationId),
          body: { userId },
          headers: scoped(companyId),
        }),
      )
      return handover
    },

    async resolveHandover(companyId, conversationId, note) {
      const handover: WhatsAppHandover = await unwrap(
        api.POST('/api/v1/whatsapp/conversations/{conversationId}/handover/resolve', {
          params: path(conversationId),
          body: note ? { note } : {},
          headers: scoped(companyId),
        }),
      )
      return handover
    },

    async reply(companyId, conversationId, body) {
      const message: Communication = await unwrap(
        api.POST('/api/v1/whatsapp/conversations/{conversationId}/replies', { params: path(conversationId), body: { body }, headers: scoped(companyId) }),
      )
      return message
    },
  }
}
