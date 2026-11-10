import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Statement } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { StatementSource } from './source'

/** Statements from the LeaseGuard API (`GET /api/v1/statements`, `GET /api/v1/statements/{statementId}`). */
export function createApiStatementSource(api: ApiClient): StatementSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/statements', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              propertyId: params.propertyId,
              tenantId: params.tenantId,
              leaseId: params.leaseId,
              sourceSystem: params.sourceSystem,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Statement[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const statement: Statement = await unwrap(
          api.GET('/api/v1/statements/{statementId}', {
            params: { path: { statementId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return statement
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
