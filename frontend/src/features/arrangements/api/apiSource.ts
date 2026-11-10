import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { PaymentArrangement } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { ArrangementSource } from './source'

/**
 * Payment arrangements from the LeaseGuard API (`GET /api/v1/arrangements`,
 * `GET /api/v1/arrangements/{arrangementId}`). Monitoring records only; nothing here moves money.
 */
export function createApiArrangementSource(api: ApiClient): ArrangementSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/arrangements', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              leaseId: params.leaseId,
              tenantId: params.tenantId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies PaymentArrangement[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const arrangement: PaymentArrangement = await unwrap(
          api.GET('/api/v1/arrangements/{arrangementId}', {
            params: { path: { arrangementId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return arrangement
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
