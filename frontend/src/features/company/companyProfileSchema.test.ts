import { describe, expect, it } from 'vitest'

import { companyProfileChangesFrom, companyProfileFormDefaults, companyProfileFormSchema } from './companyProfileSchema'

const COMPANY = {
  name: 'Nexus Properties (Pty) Ltd',
  tradingName: 'Nexus Properties',
  registrationNumber: '2019/123456/07',
  address: { line1: '12 Fredman Drive', suburb: 'Sandown', city: 'Sandton', province: 'Gauteng', postalCode: '2196', country: 'South Africa' },
  contactEmail: 'accounts@nexus.co.za',
  contactPhone: '+27 11 555 0100',
} as const

const parse = (overrides: Record<string, string> = {}) => companyProfileFormSchema.parse({ ...companyProfileFormDefaults(COMPANY), ...overrides })

describe('companyProfileFormSchema', () => {
  it('accepts the saved company and shows unset optional fields as empty', () => {
    const defaults = companyProfileFormDefaults(COMPANY)
    expect(defaults.vatNumber).toBe('')
    expect(defaults.line2).toBe('')
    expect(companyProfileFormSchema.safeParse(defaults).success).toBe(true)
  })

  it.each([
    ['name', '   ', 'Enter the registered company name'],
    ['postalCode', '21960', 'Enter the four-digit postal code'],
    ['contactEmail', 'accounts@', 'Enter a valid email address'],
    ['province', 'Transvaal', 'Choose a province'],
  ])('rejects %s "%s"', (field, value, message) => {
    const result = companyProfileFormSchema.safeParse({ ...companyProfileFormDefaults(COMPANY), [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(message)
  })
})

describe('companyProfileChangesFrom', () => {
  it('is null when nothing changed', () => {
    expect(companyProfileChangesFrom(parse(), COMPANY)).toBeNull()
    expect(companyProfileChangesFrom(parse({ name: '  Nexus Properties (Pty) Ltd ' }), COMPANY)).toBeNull()
  })

  it('sends only the fields that changed, clearing an emptied optional field with null', () => {
    expect(companyProfileChangesFrom(parse({ tradingName: '', vatNumber: '4123456789', contactPhone: '011 555 0199' }), COMPANY)).toEqual({
      tradingName: null,
      vatNumber: '4123456789',
      contactPhone: '011 555 0199',
    })
  })

  it('sends the whole address when one address field changed', () => {
    expect(companyProfileChangesFrom(parse({ line2: 'Block B', postalCode: '2146' }), COMPANY)).toEqual({
      address: { line1: '12 Fredman Drive', line2: 'Block B', suburb: 'Sandown', city: 'Sandton', province: 'Gauteng', postalCode: '2146' },
    })
  })

  it('sends every field of a company whose saved details are incomplete', () => {
    const incomplete = { ...COMPANY, address: { ...COMPANY.address, line1: '', suburb: '', city: '' }, contactPhone: '' }
    const changes = companyProfileChangesFrom(parse(), incomplete)
    expect(changes).toMatchObject({ name: COMPANY.name, contactPhone: COMPANY.contactPhone, address: { line1: '12 Fredman Drive' } })
  })
})
