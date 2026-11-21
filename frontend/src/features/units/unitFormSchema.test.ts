import type { Unit } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { newUnitFormDefaults, newUnitFrom, unitChangesFrom, unitErrorField, unitFormDefaults, unitFormSchema } from './unitFormSchema'

const PROPERTY_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'

const UNIT: Unit = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  companyId: '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e',
  propertyId: PROPERTY_ID,
  unitNumber: 'G12',
  type: 'line_shop',
  floorAreaSqm: 120.5,
  floor: 'Ground',
  occupancyStatus: 'vacant',
  description: 'Corner shop',
  createdAt: '2026-01-01T08:00:00+02:00',
  updatedAt: '2026-01-01T08:00:00+02:00',
}

const parse = (overrides: Record<string, unknown> = {}) => unitFormSchema.parse({ ...unitFormDefaults(UNIT), ...overrides })

describe('unitFormSchema', () => {
  it('accepts a saved unit and trims the unit number', () => {
    expect(parse({ unitNumber: '  G14 ' }).unitNumber).toBe('G14')
  })

  it.each([
    ['unitNumber', '  ', 'Enter the unit number'],
    ['unitNumber', 'X'.repeat(31), 'Use at most 30 characters'],
    ['floorAreaSqm', 0, 'The area must be more than 0 m²'],
    ['floorAreaSqm', 10.125, 'Use at most two decimals'],
    ['propertyId', '', 'Choose the property'],
    ['floor', 'F'.repeat(51), 'Use at most 50 characters'],
  ])('rejects %s %j', (field, value, message) => {
    const result = unitFormSchema.safeParse({ ...unitFormDefaults(UNIT), [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(message)
  })

  it('starts a new unit empty and vacant, in the given property', () => {
    expect(newUnitFormDefaults(PROPERTY_ID)).toMatchObject({ propertyId: PROPERTY_ID, unitNumber: '', occupancyStatus: 'vacant' })
    expect(newUnitFormDefaults(undefined).propertyId).toBe('')
    expect(unitFormSchema.safeParse(newUnitFormDefaults(PROPERTY_ID)).success).toBe(false)
  })
})

describe('newUnitFrom', () => {
  it('builds the create body and leaves empty optional text out', () => {
    expect(newUnitFrom(parse({ floor: '', description: '' }))).toEqual({
      propertyId: PROPERTY_ID,
      unitNumber: 'G12',
      type: 'line_shop',
      floorAreaSqm: 120.5,
      occupancyStatus: 'vacant',
    })
    expect(newUnitFrom(parse())).toMatchObject({ floor: 'Ground', description: 'Corner shop' })
  })
})

describe('unitChangesFrom', () => {
  it('is null when nothing changed', () => {
    expect(unitChangesFrom(parse(), UNIT)).toBeNull()
  })

  it('sends only the changed fields, never the property, and clears emptied text with null', () => {
    expect(unitChangesFrom(parse({ unitNumber: 'G14', occupancyStatus: 'under_offer', floor: '', description: '', propertyId: 'other' }), UNIT)).toEqual({
      unitNumber: 'G14',
      occupancyStatus: 'under_offer',
      floor: null,
      description: null,
    })
  })

  it('treats an unset floor as empty', () => {
    const { floor: _floor, ...withoutFloor } = UNIT
    expect(unitChangesFrom(parse({ floor: '' }), withoutFloor)).toBeNull()
  })
})

describe('unitErrorField', () => {
  it.each([
    [409, 'A unit numbered G12 already exists in this property', 'unitNumber'],
    [422, 'This unit has a current lease, so it stays occupied until the lease ends.', 'occupancyStatus'],
    [422, 'Choose a property in this workspace', 'propertyId'],
    [422, 'This property is archived. Restore it before adding or changing its units.', null],
    [500, 'Something went wrong', null],
  ])('places %i %j on %s', (status, message, field) => {
    expect(unitErrorField(status, message)).toBe(field)
  })
})
