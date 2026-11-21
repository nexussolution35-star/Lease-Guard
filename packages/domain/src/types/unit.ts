import type { CompanyScoped, EntityId } from './common.js'

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

/** The property a listed unit belongs to, enough to name and link it. */
export interface UnitPropertySummary {
  id: EntityId
  name: string
  code: string
}

/** The tenant of a listed unit's active lease. */
export interface UnitTenantSummary {
  id: EntityId
  tradingName: string
}

/** A listed unit's active lease: its reference and term (ISO dates). */
export interface UnitLeaseSummary {
  id: EntityId
  reference: string
  commencementDate: string
  expiryDate: string
}

/**
 * A unit as `GET /units` lists it: the unit with its property and, when it is let, the tenant and
 * lease of its active lease (read from `currentTenantId` / `currentLeaseId`, never typed in).
 */
export interface UnitListItem extends Unit {
  property: UnitPropertySummary
  currentTenant?: UnitTenantSummary
  currentLease?: UnitLeaseSummary
}
