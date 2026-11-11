import type { Property } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import {
  NO_OWNER,
  newPropertyFormDefaults,
  newPropertyFrom,
  propertyChangesFrom,
  propertyErrorField,
  propertyFormDefaults,
  propertyFormSchema,
} from './propertyFormSchema'

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const OWNER = '5b0c1d2e-0000-4000-8000-0000000000a5'

const PROPERTY: Property = {
  id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  companyId: '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e',
  name: 'Maponya Square',
  code: 'MSQ',
  type: 'shopping_centre',
  address: { line1: '2 Chris Hani Road', suburb: 'Soweto', city: 'Johannesburg', province: 'Gauteng', postalCode: '1804', country: 'South Africa' },
  description: 'Community centre',
  status: 'active',
  grossLettableAreaSqm: 12000,
  managerUserId: MANAGER,
  ownerUserId: OWNER,
  accountingSystem: 'MRI',
  createdAt: '2026-01-01T08:00:00+02:00',
  updatedAt: '2026-01-01T08:00:00+02:00',
}

const parse = (overrides: Record<string, unknown> = {}) => propertyFormSchema.parse({ ...propertyFormDefaults(PROPERTY), ...overrides })

describe('propertyFormSchema', () => {
  it('accepts a saved property and upper-cases a typed code', () => {
    expect(parse({ code: ' rbc ' }).code).toBe('RBC')
  })

  it.each([
    ['name', '  ', 'Enter the property name'],
    ['code', 'TOO-LONG1', 'Use 2 to 8 letters or digits, e.g. MSQ'],
    ['postalCode', '180', 'Enter the four-digit postal code'],
    ['grossLettableAreaSqm', 0, 'The area must be more than 0 m²'],
    ['grossLettableAreaSqm', 10.125, 'Use at most two decimals'],
    ['managerUserId', '', 'Choose the property manager'],
  ])('rejects %s %j', (field, value, message) => {
    const result = propertyFormSchema.safeParse({ ...propertyFormDefaults(PROPERTY), [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(message)
  })

  it.each([4200.35, 1.13, 2.01, 1250.1, 0.07])('accepts %s m², which has two decimals', (area) => {
    expect(propertyFormSchema.safeParse({ ...propertyFormDefaults(PROPERTY), grossLettableAreaSqm: area }).success).toBe(true)
  })

  it('starts a new property empty, active, with no owner and the signed-in user as manager', () => {
    expect(newPropertyFormDefaults(MANAGER)).toMatchObject({ name: '', status: 'active', ownerUserId: NO_OWNER, managerUserId: MANAGER })
    expect(propertyFormSchema.safeParse(newPropertyFormDefaults(MANAGER)).success).toBe(false)
  })
})

describe('newPropertyFrom', () => {
  it('builds the create body, leaving out an empty description and no owner', () => {
    const body = newPropertyFrom(parse({ code: 'rbc', description: '', ownerUserId: NO_OWNER, line2: '' }))
    expect(body).toMatchObject({ code: 'RBC', address: { line2: null }, managerUserId: MANAGER })
    expect(body).not.toHaveProperty('description')
    expect(body).not.toHaveProperty('ownerUserId')
  })
})

describe('propertyChangesFrom', () => {
  it('is null when nothing changed', () => {
    expect(propertyChangesFrom(parse(), PROPERTY)).toBeNull()
  })

  it('sends only the changed fields, the whole address when one address field changed, and null to remove the owner', () => {
    expect(propertyChangesFrom(parse({ name: 'Maponya Mall', postalCode: '1809', ownerUserId: NO_OWNER }), PROPERTY)).toEqual({
      name: 'Maponya Mall',
      ownerUserId: null,
      address: { line1: '2 Chris Hani Road', line2: null, suburb: 'Soweto', city: 'Johannesburg', province: 'Gauteng', postalCode: '1809' },
    })
  })

  it('never sends the code', () => {
    expect(propertyChangesFrom(parse({ code: 'NEW' }), PROPERTY)).toBeNull()
  })
})

describe('propertyErrorField', () => {
  it('puts a duplicate code on the code field and a manager refusal on the manager field', () => {
    expect(propertyErrorField(409, 'A property with the code MSQ already exists in this workspace.')).toBe('code')
    expect(propertyErrorField(422, 'The property manager must be a company admin or property manager of this workspace.')).toBe('managerUserId')
    expect(propertyErrorField(422, 'This property is archived. Restore it before changing it.')).toBeNull()
    expect(propertyErrorField(500, 'code')).toBeNull()
  })
})
