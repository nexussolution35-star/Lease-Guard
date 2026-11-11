import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Property } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { PropertySource } from './source'

/**
 * Properties from the LeaseGuard API: list and read (`GET /api/v1/properties`, `GET /api/v1/properties/{propertyId}`),
 * create, edit, archive and restore.
 */
export function createApiPropertySource(api: ApiClient): PropertySource {
  return {
    async list(companyId, params) {
      // PropertyDto is the wire form of the domain Property (the backend DTO `implements Property`).
      const page = await unwrap(
        api.GET('/api/v1/properties', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              type: params.type,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Property[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const property: Property = await unwrap(
          api.GET('/api/v1/properties/{propertyId}', {
            params: { path: { propertyId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return property
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    create(companyId, property) {
      return unwrap(api.POST('/api/v1/properties', { body: property, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    update(companyId, id, changes) {
      return unwrap(
        api.PATCH('/api/v1/properties/{propertyId}', { params: { path: { propertyId: id } }, body: changes, headers: { [COMPANY_ID_HEADER]: companyId } }),
      )
    },

    archive(companyId, id) {
      return unwrap(api.POST('/api/v1/properties/{propertyId}/archive', { params: { path: { propertyId: id } }, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    restore(companyId, id) {
      return unwrap(api.POST('/api/v1/properties/{propertyId}/restore', { params: { path: { propertyId: id } }, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
  }
}
