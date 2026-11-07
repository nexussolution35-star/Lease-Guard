import type { CompanyScoped, EntityId } from './common'

export const UNIT_TYPES = [
  'anchor_retail',
  'line_shop',
  'kiosk',
  'restaurant',
  'office_suite',
  'warehouse',
  'yard',
  'storage',
  'parking',
] as const
export type UnitType = (typeof UNIT_TYPES)[number]

export const OCCUPANCY_STATUSES = ['occupied', 'vacant', 'under_offer', 'unavailable'] as const
export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number]

export interface Unit extends CompanyScoped {
  propertyId: EntityId
  unitNumber: string
  type: UnitType
  floorAreaSqm: number
  floor?: string
  occupancyStatus: OccupancyStatus
  /** Denormalised for fast table rendering; must agree with the active lease. */
  currentTenantId?: EntityId
  currentLeaseId?: EntityId
  description?: string
}
