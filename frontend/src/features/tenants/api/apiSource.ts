import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Tenant } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { TenantSource } from './source'

/** Tenants from the LeaseGuard API (`GET /api/v1/tenants`, `GET /api/v1/tenants/{tenantId}`). */
export function createApiTenantSource(api: ApiClient): TenantSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/tenants', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              businessType: params.businessType,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Tenant[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const tenant: Tenant = await unwrap(
          api.GET('/api/v1/tenants/{tenantId}', {
            params: { path: { tenantId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return tenant
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
