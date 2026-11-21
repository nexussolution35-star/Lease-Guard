import type { CompanyScoped, EntityId, ISODateTime } from './common.js'

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
  /**
   * The unit's current tenant: the current lease's tenant, else the tenant assigned to it (derived in the database,
   * never typed in).
   */
  currentTenantId?: EntityId
  currentLeaseId?: EntityId
  /** The tenant assigned to the unit without a lease, while it is assigned (read from the API, never typed in). */
  currentAssignment?: UnitAssignmentSummary
  description?: string
}

/** A unit's current assignment: who holds it without a lease, and since when. */
export interface UnitAssignmentSummary {
  id: EntityId
  tenantId: EntityId
  tenantName: string
  assignedAt: ISODateTime
}

/**
 * A tenant assigned to a unit directly, without a lease (owner decision, 21 Nov 2026). Current while `endedAt` is
 * absent; an ended assignment is kept as history. A unit has at most one current assignment; a tenant may hold
 * several units. An assignment never drives monitoring or tenant messages.
 */
export interface UnitTenantAssignment extends CompanyScoped {
  propertyId: EntityId
  unitId: EntityId
  tenantId: EntityId
  assignedAt: ISODateTime
  /** Who assigned the unit; absent when the member has left the company. */
  assignedByUserId?: EntityId
  endedAt?: ISODateTime
  endedByUserId?: EntityId
}

/** An assignment as `GET /unit-assignments` lists it: with the tenant, unit and property named. */
export interface UnitTenantAssignmentListItem extends UnitTenantAssignment {
  tenantName: string
  unitNumber: string
  propertyName: string
}

/** The property a listed unit belongs to, enough to name and link it. */
export interface UnitPropertySummary {
  id: EntityId
  name: string
  code: string
}

/** A listed unit's current tenant: its current lease's tenant, else its assigned tenant. */
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
 * A unit as `GET /units` lists it: the unit with its property, its current tenant (the active lease's tenant, else the
 * assigned tenant) and, when it is let, its active lease (read from `currentTenantId` / `currentLeaseId`, never typed in).
 */
export interface UnitListItem extends Unit {
  property: UnitPropertySummary
  currentTenant?: UnitTenantSummary
  currentLease?: UnitLeaseSummary
}
