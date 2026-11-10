import type { LeaseSortField } from '@leaseguard/api-client'
import type { EntityId, Lease, LeaseStatus } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { LeaseSortField }

/** Sort fields accepted by `GET /api/v1/leases` (generated from the backend's OpenAPI document). */
export const LEASE_SORT_FIELDS = [
  'reference',
  'commencementDate',
  'expiryDate',
  'currentMonthlyRental',
  'createdAt',
] as const satisfies readonly LeaseSortField[]

/** Filters accepted by `GET /api/v1/leases`, each a single optional value. */
export interface LeaseListParams extends ListParams<LeaseSortField> {
  status?: LeaseStatus
  propertyId?: EntityId
  unitId?: EntityId
  tenantId?: EntityId
  /** Only leases whose terms are (or are not yet) verified. */
  verified?: boolean
}

/**
 * Where leases come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface LeaseSource {
  list(companyId: EntityId, params: LeaseListParams): Promise<Page<Lease>>
  get(companyId: EntityId, id: EntityId): Promise<Lease | null>
}
