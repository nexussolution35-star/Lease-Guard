import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Unit, UnitListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { UnitSource } from './source'

/** Units from the LeaseGuard API: list and read (`GET /api/v1/units`, `GET /api/v1/units/{unitId}`), create and edit. */
export function createApiUnitSource(api: ApiClient): UnitSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/units', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              propertyId: params.propertyId,
              occupancyStatus: params.occupancyStatus,
              type: params.type,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies UnitListItem[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const unit: Unit = await unwrap(
          api.GET('/api/v1/units/{unitId}', {
            params: { path: { unitId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return unit
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    create(companyId, unit) {
      return unwrap(api.POST('/api/v1/units', { body: unit, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    update(companyId, id, changes) {
      return unwrap(api.PATCH('/api/v1/units/{unitId}', { params: { path: { unitId: id } }, body: changes, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
  }
}
