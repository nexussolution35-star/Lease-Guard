import { describe, expect, it } from 'vitest'

import {
  canChooseUnitForAssignment,
  describeUnitAssignmentAvailability,
  leaseTenantForUnit,
  unitAssignmentAvailability,
  type AssignableUnit,
} from './unitAssignment.js'

const KASI = { id: 'tenant-kasi', tradingName: 'Kasi Flame Grill' }
const LEASE = { id: 'lease-1', reference: 'MSQ-L001', commencementDate: '2025-01-01', expiryDate: '2029-12-31' }
const ASSIGNMENT = { id: 'a1', tenantId: KASI.id, tenantName: KASI.tradingName, assignedAt: '2026-11-21T08:00:00Z' }

const vacant: AssignableUnit = {}
const let_: AssignableUnit = { currentTenant: KASI, currentLease: LEASE }
const assigned: AssignableUnit = { currentTenant: KASI, currentAssignment: ASSIGNMENT }

describe('unitAssignmentAvailability', () => {
  it('offers a vacant unit', () => {
    expect(unitAssignmentAvailability(vacant, 'other', 'active')).toEqual({ kind: 'available' })
  })

  it('refuses a unit whose active lease is another tenant’s, naming the tenant and lease', () => {
    const availability = unitAssignmentAvailability(let_, 'other', 'active')
    expect(availability).toEqual({ kind: 'let', holder: 'Kasi Flame Grill', leaseReference: 'MSQ-L001' })
    expect(describeUnitAssignmentAvailability(availability)).toBe('Let to Kasi Flame Grill (MSQ-L001)')
    expect(canChooseUnitForAssignment(availability)).toBe(false)
  })

  it('offers a let unit to the lease’s own tenant', () => {
    expect(unitAssignmentAvailability(let_, KASI.id, 'active')).toEqual({ kind: 'available' })
  })

  it('refuses a unit assigned to another tenant, naming who holds it', () => {
    const availability = unitAssignmentAvailability(assigned, 'other', 'active')
    expect(availability).toEqual({ kind: 'held', holder: 'Kasi Flame Grill' })
    expect(describeUnitAssignmentAvailability(availability)).toBe('Assigned to Kasi Flame Grill')
  })

  it('marks a unit the tenant already holds', () => {
    const availability = unitAssignmentAvailability(assigned, KASI.id, 'active')
    expect(availability).toEqual({ kind: 'assigned' })
    expect(canChooseUnitForAssignment(availability)).toBe(false)
  })

  it('refuses every unit of an archived property', () => {
    expect(unitAssignmentAvailability(vacant, 'other', 'archived')).toEqual({ kind: 'archived' })
    expect(describeUnitAssignmentAvailability({ kind: 'archived' })).toBe('Property archived')
  })

  it('offers any unassigned, unlet unit while no tenant is chosen yet', () => {
    expect(canChooseUnitForAssignment(unitAssignmentAvailability(vacant, undefined, undefined))).toBe(true)
    expect(canChooseUnitForAssignment(unitAssignmentAvailability(assigned, undefined, 'active'))).toBe(false)
  })
})

describe('leaseTenantForUnit', () => {
  it('is the assigned tenant', () => {
    expect(leaseTenantForUnit(assigned)).toBe(KASI.id)
  })

  it('is undefined for a unit that is not assigned', () => {
    expect(leaseTenantForUnit(let_)).toBeUndefined()
  })
})
