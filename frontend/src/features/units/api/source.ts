import type { UnitSortField } from '@leaseguard/api-client'
import type { EntityId, OccupancyStatus, Unit, UnitType } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { UnitSortField }

/** Sort fields accepted by `GET /api/v1/units` (generated from the backend's OpenAPI document). */
export const UNIT_SORT_FIELDS = ['unitNumber', 'floorAreaSqm', 'occupancyStatus', 'createdAt'] as const satisfies readonly UnitSortField[]

/** Filters accepted by `GET /api/v1/units`, each a single optional value. */
export interface UnitListParams extends ListParams<UnitSortField> {
  propertyId?: EntityId
  occupancyStatus?: OccupancyStatus
  type?: UnitType
}

/**
 * Where units come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface UnitSource {
  list(companyId: EntityId, params: UnitListParams): Promise<Page<Unit>>
  get(companyId: EntityId, id: EntityId): Promise<Unit | null>
}
