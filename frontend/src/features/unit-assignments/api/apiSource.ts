import { COMPANY_ID_HEADER, compactQuery, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { UnitTenantAssignmentListItem } from '@leaseguard/domain'

import type { UnitAssignmentSource } from './source'

/** Unit assignments from the LeaseGuard API: list, assign (`POST /unit-assignments`) and unassign (`POST …/{id}/end`). */
export function createApiUnitAssignmentSource(api: ApiClient): UnitAssignmentSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/unit-assignments', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              sort: params.sort,
              direction: params.direction,
              tenantId: params.tenantId,
              unitId: params.unitId,
              propertyId: params.propertyId,
              current: params.current,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies UnitTenantAssignmentListItem[] }
    },

    assign(companyId, assignment) {
      return unwrap(api.POST('/api/v1/unit-assignments', { body: assignment, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    end(companyId, assignmentId) {
      return unwrap(
        api.POST('/api/v1/unit-assignments/{assignmentId}/end', {
          params: { path: { assignmentId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
  }
}
