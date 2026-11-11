import type { CreatePropertyDto, PropertySortField, UpdatePropertyDto } from '@leaseguard/api-client'
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
/** `POST /properties` body. The code is fixed once the property exists. */
export type NewProperty = CreatePropertyDto

/** `PATCH /properties/{id}` body: omitted fields are unchanged; an address replaces the whole address. */
export type PropertyChanges = UpdatePropertyDto

export interface PropertySource {
  list(companyId: EntityId, params: PropertyListParams): Promise<Page<Property>>
  /** Null when the property does not exist in that company (API 404). */
  get(companyId: EntityId, id: EntityId): Promise<Property | null>
  /** Company admins and property managers. Rejects with 409 for a code already used, 422 for a manager who does not qualify. */
  create(companyId: EntityId, property: NewProperty): Promise<Property>
  /** Rejects with 422 while the property is archived. */
  update(companyId: EntityId, id: EntityId, changes: PropertyChanges): Promise<Property>
  /** Rejects with 409 while the property has a lease that has not ended. */
  archive(companyId: EntityId, id: EntityId): Promise<Property>
  restore(companyId: EntityId, id: EntityId): Promise<Property>
}
