import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Unit } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { UnitSource } from './source'

/** Units from the LeaseGuard API (`GET /api/v1/units`, `GET /api/v1/units/{unitId}`). */
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
      return { ...page, items: page.items satisfies Unit[] }
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
  }
}
