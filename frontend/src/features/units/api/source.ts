import type { CreateUnitDto, UnitSortField, UpdateUnitDto } from '@leaseguard/api-client'
import type { EntityId, OccupancyStatus, Unit, UnitListItem, UnitType } from '@leaseguard/domain'

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
 * Listed units carry their property and, when let, the tenant and lease of the active lease.
 */
export interface UnitSource {
  list(companyId: EntityId, params: UnitListParams): Promise<Page<UnitListItem>>
  get(companyId: EntityId, id: EntityId): Promise<Unit | null>
  /** Company admins and property managers. Rejects with 409 for a unit number already used in the property, 422 for an archived property. */
  create(companyId: EntityId, unit: NewUnit): Promise<Unit>
  /** Rejects with 409 for a taken unit number, 422 when a leased unit is made anything but occupied or the property is archived. */
  update(companyId: EntityId, id: EntityId, changes: UnitChanges): Promise<Unit>
}

/** `POST /units` body. The current tenant and lease come from the active lease and are never sent. */
export type NewUnit = CreateUnitDto

/** `PATCH /units/{id}` body: omitted fields are unchanged; the property cannot change. */
export type UnitChanges = UpdateUnitDto
