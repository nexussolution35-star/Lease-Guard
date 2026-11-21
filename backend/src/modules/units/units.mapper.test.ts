import { describe, expect, it } from 'vitest'

import { toUnit, toUnitListItem } from './units.mapper'
import { unitListRow, unitRow } from './units.test-helpers'

describe('units mapper', () => {
  it('maps an occupied unit to the domain Unit', () => {
    expect(toUnit(unitRow)).toEqual({
      id: unitRow.id,
      companyId: unitRow.company_id,
      propertyId: unitRow.property_id,
      unitNumber: 'G12',
      type: 'line_shop',
      floorAreaSqm: 145.5,
      floor: 'Ground',
      occupancyStatus: 'occupied',
      currentTenantId: unitRow.current_tenant_id,
      currentLeaseId: unitRow.current_lease_id,
      createdAt: unitRow.created_at,
      updatedAt: unitRow.updated_at,
    })
  })

  it('drops null optional fields of a vacant unit', () => {
    const unit = toUnit({
      ...unitRow,
      occupancy_status: 'vacant',
      floor: null,
      current_tenant_id: null,
      current_lease_id: null,
      description: 'Corner shop',
    })
    expect(unit).toMatchObject({ occupancyStatus: 'vacant', description: 'Corner shop' })
    expect(unit).not.toHaveProperty('floor')
    expect(unit).not.toHaveProperty('currentTenantId')
    expect(unit).not.toHaveProperty('currentLeaseId')
  })

  it('maps a listed unit with its property, tenant and active lease', () => {
    expect(toUnitListItem(unitListRow)).toEqual({
      ...toUnit(unitRow),
      property: { id: unitRow.property_id, name: 'Maponya Square', code: 'MSQ' },
      currentTenant: { id: unitRow.current_tenant_id, tradingName: 'Thrifty Foods' },
      currentLease: { id: unitRow.current_lease_id, reference: 'MSQ-G12', commencementDate: '2025-03-01', expiryDate: '2030-02-28' },
    })
  })

  it('lists a vacant unit without tenant or lease', () => {
    const item = toUnitListItem({
      ...unitListRow,
      occupancy_status: 'vacant',
      current_tenant_id: null,
      current_lease_id: null,
      current_tenant: null,
      current_lease: null,
    })
    expect(item.property.code).toBe('MSQ')
    expect(item).not.toHaveProperty('currentTenant')
    expect(item).not.toHaveProperty('currentLease')
    expect(item).not.toHaveProperty('current_tenant')
  })

  it('lists an assigned unit with its assigned tenant and current assignment, and no lease', () => {
    const item = toUnitListItem({
      ...unitListRow,
      current_lease_id: null,
      current_lease: null,
      assignments: [
        { id: 'a-old', tenant_id: 't-old', assigned_at: '2026-01-01T08:00:00Z', ended_at: '2026-06-01T08:00:00Z', tenant: { trading_name: 'Gone Ltd' } },
        { id: 'a-now', tenant_id: unitRow.current_tenant_id!, assigned_at: '2026-11-21T08:00:00Z', ended_at: null, tenant: { trading_name: 'Thrifty Foods' } },
      ],
    })
    expect(item.currentTenant).toEqual({ id: unitRow.current_tenant_id, tradingName: 'Thrifty Foods' })
    expect(item.currentAssignment).toEqual({ id: 'a-now', tenantId: unitRow.current_tenant_id, tenantName: 'Thrifty Foods', assignedAt: '2026-11-21T08:00:00Z' })
    expect(item).not.toHaveProperty('currentLease')
    expect(item).not.toHaveProperty('assignments')
  })

  it('leaves the assignment out when every assignment has ended', () => {
    const unit = toUnit({ ...unitRow, assignments: [{ id: 'a', tenant_id: 't', assigned_at: '2026-01-01T08:00:00Z', ended_at: '2026-02-01T08:00:00Z', tenant: null }] })
    expect(unit).not.toHaveProperty('currentAssignment')
  })

  it('refuses a listed unit without its property', () => {
    expect(() => toUnitListItem({ ...unitListRow, property: null })).toThrow(/without its property/)
  })
})
