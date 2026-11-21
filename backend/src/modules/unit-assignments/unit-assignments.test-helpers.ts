import type { UnitAssignmentListRow } from './unit-assignments.mapper'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
export const TENANT = '6f1d2c1e-0000-4000-8000-0000000000e1'
export const UNIT = '6f1d2c1e-0000-4000-8000-0000000000d1'
export const ASSIGNMENT = '6f1d2c1e-0000-4000-8000-0000000000a9'

/** A current assignment as `GET /unit-assignments` reads it, with its tenant and unit (and the unit's property). */
export const assignmentListRow: UnitAssignmentListRow = {
  id: ASSIGNMENT,
  company_id: COMPANY,
  property_id: '6f1d2c1e-0000-4000-8000-0000000000aa',
  unit_id: UNIT,
  tenant_id: TENANT,
  assigned_at: '2026-11-21T08:00:00+00:00',
  assigned_by_user_id: '6f1d2c1e-0000-4000-8000-0000000000b9',
  ended_at: null,
  ended_by_user_id: null,
  created_at: '2026-11-21T08:00:00+00:00',
  updated_at: '2026-11-21T08:00:00+00:00',
  tenant: { trading_name: 'Thrifty Foods' },
  unit: { unit_number: 'G12', property: { name: 'Maponya Square' } },
}
