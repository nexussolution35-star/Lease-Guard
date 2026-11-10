import type { PropertySortField } from '@leaseguard/api-client'
import type { EntityId, Property, PropertyStatus, PropertyType } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

/** Sort fields accepted by `GET /api/v1/properties` (generated from the backend's OpenAPI document). */
export const PROPERTY_SORT_FIELDS = ['name', 'code', 'createdAt'] as const satisfies readonly PropertySortField[]

export interface PropertyListParams extends ListParams<PropertySortField> {
  status?: PropertyStatus
  type?: PropertyType
}

/**
 * Where property records come from (the LeaseGuard API). The company is
 * explicit so a request always matches the company id in its query key.
 */
export interface PropertySource {
  list(companyId: EntityId, params: PropertyListParams): Promise<Page<Property>>
  /** Null when the property does not exist in that company (API 404). */
  get(companyId: EntityId, id: EntityId): Promise<Property | null>
}
