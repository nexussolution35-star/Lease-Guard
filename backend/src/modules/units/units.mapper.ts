import type { Unit } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type UnitRow = Tables<'units'>

/** Database row → domain `Unit`. Nullable columns become absent optional fields. */
export function toUnit(row: UnitRow): Unit {
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
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
