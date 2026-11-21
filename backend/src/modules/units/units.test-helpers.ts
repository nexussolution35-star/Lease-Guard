import type { UnitListRow, UnitRow } from './units.mapper'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'

export const unitRow: UnitRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000d1',
  company_id: COMPANY,
  property_id: '6f1d2c1e-0000-4000-8000-0000000000aa',
  unit_number: 'G12',
  type: 'line_shop',
  floor_area_sqm: 145.5,
  floor: 'Ground',
  occupancy_status: 'occupied',
  current_tenant_id: '6f1d2c1e-0000-4000-8000-0000000000e1',
  current_lease_id: '6f1d2c1e-0000-4000-8000-0000000000f1',
  description: null,
  created_at: '2026-11-01T08:00:00+00:00',
  updated_at: '2026-11-01T08:00:00+00:00',
}

/** `unitRow` as `GET /units` reads it, with its property, tenant and active lease embedded. */
export const unitListRow: UnitListRow = {
  ...unitRow,
  property: { id: unitRow.property_id, name: 'Maponya Square', code: 'MSQ' },
  current_tenant: { id: unitRow.current_tenant_id!, trading_name: 'Thrifty Foods' },
  current_lease: {
    id: unitRow.current_lease_id!,
    reference: 'MSQ-G12',
    commencement_date: '2025-03-01',
    expiry_date: '2030-02-28',
  },
}
