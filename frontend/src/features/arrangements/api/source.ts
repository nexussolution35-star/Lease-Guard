import type { ArrangementSortField } from '@leaseguard/api-client'
import type { ArrangementStatus, EntityId, PaymentArrangement } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { ArrangementSortField }

/** Sort fields accepted by `GET /api/v1/arrangements` (generated from the backend's OpenAPI document). */
export const ARRANGEMENT_SORT_FIELDS = ['agreedOn', 'firstInstallmentDate', 'createdAt'] as const satisfies readonly ArrangementSortField[]

/** Filters accepted by `GET /api/v1/arrangements`, each a single optional value. */
export interface ArrangementListParams extends ListParams<ArrangementSortField> {
  status?: ArrangementStatus
  leaseId?: EntityId
  tenantId?: EntityId
}

/**
 * Where payment arrangements (monitoring records, never payments) come from. Same contract as
 * `PropertySource`: the company is explicit, lists resolve to API-shaped pages and `get` resolves to
 * null when the record is not in that company.
 */
export interface ArrangementSource {
  list(companyId: EntityId, params: ArrangementListParams): Promise<Page<PaymentArrangement>>
  get(companyId: EntityId, id: EntityId): Promise<PaymentArrangement | null>
}
