import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { PaymentArrangementListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { ArrangementSource } from './source'

/**
 * Payment arrangements from the LeaseGuard API: list, get, record, edit, close, cancel and instalment outcomes
 * (`/api/v1/arrangements/**`). Monitoring records only; nothing here moves money.
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
              propertyId: params.propertyId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies PaymentArrangementListItem[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const arrangement: PaymentArrangementListItem = await unwrap(
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

    create(companyId, arrangement) {
      return unwrap(api.POST('/api/v1/arrangements', { body: arrangement, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    update(companyId, id, changes) {
      return unwrap(
        api.PATCH('/api/v1/arrangements/{arrangementId}', {
          params: { path: { arrangementId: id } },
          body: changes,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },

    close(companyId, id, closing) {
      return unwrap(
        api.POST('/api/v1/arrangements/{arrangementId}/close', {
          params: { path: { arrangementId: id } },
          body: closing,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },

    cancel(companyId, id, cancellation) {
      return unwrap(
        api.POST('/api/v1/arrangements/{arrangementId}/cancel', {
          params: { path: { arrangementId: id } },
          body: cancellation,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },

    recordInstallmentOutcome(companyId, id, installmentId, outcome) {
      return unwrap(
        api.POST('/api/v1/arrangements/{arrangementId}/installments/{installmentId}/outcome', {
          params: { path: { arrangementId: id, installmentId } },
          body: outcome,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
  }
}
