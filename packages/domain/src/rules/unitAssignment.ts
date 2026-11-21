import type { EntityId } from '../types/common.js'
import type { PropertyStatus } from '../types/property.js'
import type { UnitAssignmentSummary, UnitLeaseSummary, UnitTenantSummary } from '../types/unit.js'

/** What a unit picker knows about a unit: its current tenant, its active lease and its assignment (all from the API). */
export interface AssignableUnit {
  currentTenant?: UnitTenantSummary
  currentLease?: UnitLeaseSummary
  currentAssignment?: UnitAssignmentSummary
}

/**
 * Whether a unit can be assigned to a tenant, as far as the listed unit shows (the database decides and refuses the
 * rest, naming who holds the unit):
 *   * `available`: it can be assigned;
 *   * `assigned`: the tenant already holds it by assignment;
 *   * `let`: its active lease is another tenant's, so it cannot be assigned to someone else;
 *   * `held`: it is assigned to another tenant, who must be unassigned first;
 *   * `archived`: its property is archived.
 */
export type UnitAssignmentAvailability =
  | { kind: 'available' }
  | { kind: 'assigned' }
  | { kind: 'let'; holder: string; leaseReference: string }
  | { kind: 'held'; holder: string }
  | { kind: 'archived' }

export function unitAssignmentAvailability(
  unit: AssignableUnit,
  tenantId: EntityId | undefined,
  propertyStatus: PropertyStatus | undefined,
): UnitAssignmentAvailability {
  if (propertyStatus === 'archived') return { kind: 'archived' }
  if (unit.currentLease && unit.currentTenant && unit.currentTenant.id !== tenantId) {
    return { kind: 'let', holder: unit.currentTenant.tradingName, leaseReference: unit.currentLease.reference }
  }
  if (unit.currentAssignment) {
    return unit.currentAssignment.tenantId === tenantId ? { kind: 'assigned' } : { kind: 'held', holder: unit.currentAssignment.tenantName }
  }
  return { kind: 'available' }
}

/** True when the unit can be chosen for `tenantId` (available, or already the tenant's). */
export function canChooseUnitForAssignment(availability: UnitAssignmentAvailability): boolean {
  return availability.kind === 'available'
}

/** Why a unit cannot be assigned, in words, or undefined when it can. */
export function describeUnitAssignmentAvailability(availability: UnitAssignmentAvailability): string | undefined {
  switch (availability.kind) {
    case 'available':
      return undefined
    case 'assigned':
      return 'Already assigned to this tenant'
    case 'let':
      return `Let to ${availability.holder} (${availability.leaseReference})`
    case 'held':
      return `Assigned to ${availability.holder}`
    case 'archived':
      return 'Property archived'
  }
}

/**
 * The tenant a new lease of the unit is for: the tenant the unit is assigned to, or undefined when it is not assigned.
 * The database refuses a lease of an assigned unit for anyone else.
 */
export function leaseTenantForUnit(unit: Pick<AssignableUnit, 'currentAssignment'>): EntityId | undefined {
  return unit.currentAssignment?.tenantId
}
