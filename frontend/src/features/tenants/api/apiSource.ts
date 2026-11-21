import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Tenant, TenantListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { TenantSource } from './source'

/**
 * Tenants from the LeaseGuard API: list and read (`GET /api/v1/tenants`, `GET /api/v1/tenants/{tenantId}`), create, edit
 * and validate the WhatsApp number (`POST /api/v1/tenants/{tenantId}/whatsapp-validation`).
 */
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
              propertyId: params.propertyId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies TenantListItem[] }
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

    create(companyId, tenant) {
      return unwrap(api.POST('/api/v1/tenants', { body: tenant, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    update(companyId, id, changes) {
      return unwrap(
        api.PATCH('/api/v1/tenants/{tenantId}', { params: { path: { tenantId: id } }, body: changes, headers: { [COMPANY_ID_HEADER]: companyId } }),
      )
    },

    validateWhatsApp(companyId, id, whatsappNumber) {
      return unwrap(
        api.POST('/api/v1/tenants/{tenantId}/whatsapp-validation', {
          params: { path: { tenantId: id } },
          body: { whatsappNumber },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
  }
}
