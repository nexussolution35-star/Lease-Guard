import type { StatementSortField } from '@leaseguard/api-client'
import type { EntityId, Statement, StatementSource as StatementSourceSystem, StatementStatus } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { StatementSortField }

/** Sort fields accepted by `GET /api/v1/statements` (generated from the backend's OpenAPI document). */
export const STATEMENT_SORT_FIELDS = ['statementDate', 'uploadedAt'] as const satisfies readonly StatementSortField[]

/** Filters accepted by `GET /api/v1/statements`, each a single optional value. */
export interface StatementListParams extends ListParams<StatementSortField> {
  status?: StatementStatus
  propertyId?: EntityId
  tenantId?: EntityId
  leaseId?: EntityId
  /** Accounting system the statement came from (MRI, MDA, …). */
  sourceSystem?: StatementSourceSystem
}

/**
 * Where statements come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface StatementSource {
  list(companyId: EntityId, params: StatementListParams): Promise<Page<Statement>>
  get(companyId: EntityId, id: EntityId): Promise<Statement | null>
}
