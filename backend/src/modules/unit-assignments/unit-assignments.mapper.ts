import type { UnitTenantAssignment, UnitTenantAssignmentListItem } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type UnitAssignmentRow = Tables<'unit_tenant_assignments'>

/** Each assignment with its tenant, and its unit with the unit's property, through the composite company-scoped keys. */
export const UNIT_ASSIGNMENT_SELECT =
  '*, tenant:tenants!unit_tenant_assignments_tenant_fk(trading_name), unit:units!unit_tenant_assignments_unit_fk(unit_number, property:properties!units_property_fk(name))'

export type UnitAssignmentListRow = UnitAssignmentRow & {
  tenant: Pick<Tables<'tenants'>, 'trading_name'> | null
  unit: (Pick<Tables<'units'>, 'unit_number'> & { property: Pick<Tables<'properties'>, 'name'> | null }) | null
}

/** Database row → domain `UnitTenantAssignment`. Nullable columns become absent optional fields. */
export function toUnitAssignment(row: UnitAssignmentRow): UnitTenantAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    tenantId: row.tenant_id,
    assignedAt: row.assigned_at,
    ...(row.assigned_by_user_id ? { assignedByUserId: row.assigned_by_user_id } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    ...(row.ended_by_user_id ? { endedByUserId: row.ended_by_user_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** An assignment with its tenant, unit and property named. The foreign keys guarantee each exists. */
export function toUnitAssignmentListItem(row: UnitAssignmentListRow): UnitTenantAssignmentListItem {
  const { tenant, unit, ...assignment } = row
  if (!tenant || !unit) throw new Error(`Assignment ${row.id} was listed without its tenant or unit`)
  return {
    ...toUnitAssignment(assignment),
    tenantName: tenant.trading_name,
    unitNumber: unit.unit_number,
    propertyName: unit.property?.name ?? '',
  }
}
