import type { Unit, UnitListItem } from '@leaseguard/domain'

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

/** The related rows `GET /units` embeds with each unit (see `UNIT_LIST_SELECT`). */
export interface UnitListRow extends UnitRow {
  property: Pick<Tables<'properties'>, 'id' | 'name' | 'code'> | null
  current_tenant: Pick<Tables<'tenants'>, 'id' | 'trading_name'> | null
  current_lease: Pick<Tables<'leases'>, 'id' | 'reference' | 'commencement_date' | 'expiry_date'> | null
}

/**
 * Database row with its embedded property, tenant and lease → `UnitListItem`. The property always
 * exists (foreign key); the tenant and lease are present only while the unit has an active lease.
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
