import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Lease } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { LeaseSource } from './source'

/** Leases from the LeaseGuard API (`GET /api/v1/leases`, `GET /api/v1/leases/{leaseId}`). */
export function createApiLeaseSource(api: ApiClient): LeaseSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/leases', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              propertyId: params.propertyId,
              unitId: params.unitId,
              tenantId: params.tenantId,
              verified: params.verified,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Lease[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const lease: Lease = await unwrap(
          api.GET('/api/v1/leases/{leaseId}', {
            params: { path: { leaseId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return lease
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
