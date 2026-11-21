import type { Unit, UnitAssignmentSummary, UnitListItem } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type UnitRow = Tables<'units'>

/**
 * The unit's assignments embedded with it (`UNIT_ASSIGNMENT_EMBED`), with the tenant's name. Only the current one
 * (no `ended_at`) is read; list and get also filter the embed to it.
 */
export type UnitAssignmentRow = Pick<Tables<'unit_tenant_assignments'>, 'id' | 'tenant_id' | 'assigned_at' | 'ended_at'> & {
  tenant: Pick<Tables<'tenants'>, 'trading_name'> | null
}

/** A unit row, optionally with its embedded assignments. */
export type UnitWithAssignmentsRow = UnitRow & { assignments?: UnitAssignmentRow[] | null }

function toAssignmentSummary(rows: UnitAssignmentRow[] | null | undefined): UnitAssignmentSummary | undefined {
  const current = (rows ?? []).find((row) => row.ended_at === null)
  if (!current) return undefined
  return { id: current.id, tenantId: current.tenant_id, tenantName: current.tenant?.trading_name ?? '', assignedAt: current.assigned_at }
}

/** Database row → domain `Unit`. Nullable columns become absent optional fields. */
export function toUnit(withAssignments: UnitWithAssignmentsRow): Unit {
  const { assignments, ...row } = withAssignments
  const assignment = toAssignmentSummary(assignments)
  return {
    id: row.id,
    companyId: row.company_id,
    propertyId: row.property_id,
    unitNumber: row.unit_number,
    type: row.type,
    floorAreaSqm: row.floor_area_sqm,
    ...(row.floor ? { floor: row.floor } : {}),
    occupancyStatus: row.occupancy_status,
    ...(row.current_tenant_id ? { currentTenantId: row.current_tenant_id } : {}),
    ...(row.current_lease_id ? { currentLeaseId: row.current_lease_id } : {}),
    ...(assignment ? { currentAssignment: assignment } : {}),
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The related rows `GET /units` embeds with each unit (see `UNIT_LIST_SELECT`). */
export interface UnitListRow extends UnitWithAssignmentsRow {
  property: Pick<Tables<'properties'>, 'id' | 'name' | 'code'> | null
  current_tenant: Pick<Tables<'tenants'>, 'id' | 'trading_name'> | null
  current_lease: Pick<Tables<'leases'>, 'id' | 'reference' | 'commencement_date' | 'expiry_date'> | null
}

/**
 * Database row with its embedded property, tenant, lease and assignment → `UnitListItem`. The property always exists
 * (foreign key); the tenant is the current lease's, else the assigned tenant; the lease is present only while the unit
 * has a current lease.
 */
export function toUnitListItem(row: UnitListRow): UnitListItem {
  const { property, current_tenant: tenant, current_lease: lease, ...unit } = row
  if (!property) throw new Error(`Unit ${row.id} was listed without its property`)
  return {
    ...toUnit(unit),
    property: { id: property.id, name: property.name, code: property.code },
    ...(tenant ? { currentTenant: { id: tenant.id, tradingName: tenant.trading_name } } : {}),
    ...(lease
      ? {
          currentLease: {
            id: lease.id,
            reference: lease.reference,
            commencementDate: lease.commencement_date,
            expiryDate: lease.expiry_date,
          },
        }
      : {}),
  }
}
