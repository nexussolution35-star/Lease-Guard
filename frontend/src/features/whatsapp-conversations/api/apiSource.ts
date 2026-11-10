import { COMPANY_ID_HEADER, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { WhatsAppConversation, WhatsAppConversationSummary } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'

import type { ConversationSource } from './source'

/** Conversations from the LeaseGuard API (`GET /api/v1/whatsapp/conversations`, `…/{conversationId}`). */
export function createApiConversationSource(api: ApiClient): ConversationSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/whatsapp/conversations', {
          params: { query: { page: params.page, pageSize: params.pageSize } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies WhatsAppConversationSummary[] }
    },

    async get(companyId, conversationId) {
      if (!isUuid(conversationId)) return null
      try {
        const conversation: WhatsAppConversation = await unwrap(
          api.GET('/api/v1/whatsapp/conversations/{conversationId}', {
            params: { path: { conversationId } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return conversation
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
