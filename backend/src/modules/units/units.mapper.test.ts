import { describe, expect, it } from 'vitest'

import { toUnit } from './units.mapper'
import { unitRow } from './units.test-helpers'

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
})
