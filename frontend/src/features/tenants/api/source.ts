import type { TenantSortField } from '@leaseguard/api-client'
import type { BusinessType, EntityId, Tenant, TenantStatus } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { TenantSortField }

/** Sort fields accepted by `GET /api/v1/tenants` (generated from the backend's OpenAPI document). */
export const TENANT_SORT_FIELDS = ['tradingName', 'legalName', 'status', 'createdAt'] as const satisfies readonly TenantSortField[]

/** Filters accepted by `GET /api/v1/tenants`, each a single optional value. */
export interface TenantListParams extends ListParams<TenantSortField> {
  status?: TenantStatus
  businessType?: BusinessType
}

/**
 * Where tenants come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface TenantSource {
  list(companyId: EntityId, params: TenantListParams): Promise<Page<Tenant>>
  get(companyId: EntityId, id: EntityId): Promise<Tenant | null>
}
