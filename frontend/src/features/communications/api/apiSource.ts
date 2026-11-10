import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Communication } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { CommunicationSource } from './source'

/**
 * Communications from the LeaseGuard API (`GET /api/v1/communications`,
 * `GET /api/v1/communications/{communicationId}`).
 */
export function createApiCommunicationSource(api: ApiClient): CommunicationSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/communications', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              messageType: params.messageType,
              recipientType: params.recipientType,
              channel: params.channel,
              tenantId: params.tenantId,
              propertyId: params.propertyId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Communication[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const communication: Communication = await unwrap(
          api.GET('/api/v1/communications/{communicationId}', {
            params: { path: { communicationId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return communication
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
