import { describe, expect, it } from 'vitest'

import { PORTFOLIO_IMPORT_FIELD_KEYS } from '../types/index.js'
import {
  applicablePortfolioImportMapping,
  businessTypeFromRegistrationNumber,
  normalizePortfolioHeader,
  PORTFOLIO_IMPORT_HEADER_SYNONYMS,
  portfolioImportHeaderSignature,
  portfolioImportMappingProblems,
  portfolioTenantIdentifierKey,
  readPortfolioBusinessType,
  readPortfolioNumber,
  readPortfolioOccupancyStatus,
  readPortfolioPostalCode,
  readPortfolioPropertyType,
  readPortfolioProvince,
  readPortfolioTenantPhone,
  readPortfolioUnitType,
  suggestPortfolioImportMapping,
} from './portfolioImportMapping.js'
import { PORTFOLIO_IMPORT_FIELDS, portfolioImportFieldsFor } from './portfolioImportTemplate.js'

describe('normalizePortfolioHeader', () => {
  it('ignores case, punctuation, accents and a trailing area unit', () => {
    expect(normalizePortfolioHeader('Floor area (m²)')).toBe('floorarea')
    expect(normalizePortfolioHeader('FLOOR_AREA')).toBe('floorarea')
    expect(normalizePortfolioHeader('Floor Area sqm')).toBe('floorarea')
    expect(normalizePortfolioHeader('  Unit # ')).toBe('unitno')
    expect(normalizePortfolioHeader('Café')).toBe('cafe')
    expect(normalizePortfolioHeader('m²')).toBe('m2')
  })
})

describe('suggestPortfolioImportMapping', () => {
  it("maps LeaseGuard's own template headings to every field", () => {
    const columns = PORTFOLIO_IMPORT_FIELDS.map((field) => field.header)
    const mapping = suggestPortfolioImportMapping(columns, 'properties')
    expect(mapping).toEqual(Object.fromEntries(PORTFOLIO_IMPORT_FIELDS.map((field) => [field.key, field.header])))
  })

  it('maps the usual MRI export headings', () => {
    expect(suggestPortfolioImportMapping(['BLDGID', 'Building Name', 'SUITID', 'Suite Type', 'Suite Area', 'Occupancy'], 'properties')).toEqual({
      propertyCode: 'BLDGID',
      propertyName: 'Building Name',
      unitNumber: 'SUITID',
      unitType: 'Suite Type',
      floorAreaSqm: 'Suite Area',
      occupancyStatus: 'Occupancy',
    })
  })

  it('maps the usual MDA, PropSys and Sage export headings', () => {
    expect(suggestPortfolioImportMapping(['Prop Code', 'Prop Name', 'Unit No', 'Unit Size', 'Status'], 'properties')).toEqual({
      propertyCode: 'Prop Code',
      propertyName: 'Prop Name',
      unitNumber: 'Unit No',
      floorAreaSqm: 'Unit Size',
      occupancyStatus: 'Status',
    })
    expect(suggestPortfolioImportMapping(['Property Code', 'Property Name', 'Unit Code', 'Unit Area', 'GLA', 'Post Code'], 'properties')).toEqual({
      propertyCode: 'Property Code',
      propertyName: 'Property Name',
      unitNumber: 'Unit Code',
      floorAreaSqm: 'Unit Area',
      grossLettableAreaSqm: 'GLA',
      postalCode: 'Post Code',
    })
    expect(suggestPortfolioImportMapping(['Property', 'Address', 'Town', 'Unit', 'Area'], 'properties')).toEqual({
      propertyName: 'Property',
      addressLine1: 'Address',
      city: 'Town',
      unitNumber: 'Unit',
      floorAreaSqm: 'Area',
    })
  })

  it('reads area headings as the unit floor area when units of one property are imported', () => {
    expect(suggestPortfolioImportMapping(['Shop No', 'GLA', 'Property code'], 'units')).toEqual({ unitNumber: 'Shop No', floorAreaSqm: 'GLA' })
  })

  it('keeps the first column when two fit one field, and leaves unknown headings unmapped', () => {
    expect(suggestPortfolioImportMapping(['Unit', 'Unit number', 'Lease start', 'Monthly rent'], 'units')).toEqual({ unitNumber: 'Unit' })
  })

  it('suggests the tenant register columns of a rent roll export', () => {
    expect(
      suggestPortfolioImportMapping(
        ['BLDGID', 'SUITID', 'Occupant Name', 'Registered name', 'Reg No', 'Occupant ID', 'Entity type', 'Contact person', 'E-mail', 'Cell No'],
        'properties',
      ),
    ).toEqual({
      propertyCode: 'BLDGID',
      unitNumber: 'SUITID',
      tenantTradingName: 'Occupant Name',
      tenantLegalName: 'Registered name',
      tenantRegistrationNumber: 'Reg No',
      tenantAccountReference: 'Occupant ID',
      tenantBusinessType: 'Entity type',
      tenantContactPerson: 'Contact person',
      tenantEmail: 'E-mail',
      tenantPhone: 'Cell No',
    })
    expect(suggestPortfolioImportMapping(['Unit', 'Tenant', 'Tenant code', 'Tel'], 'units')).toEqual({
      unitNumber: 'Unit',
      tenantTradingName: 'Tenant',
      tenantAccountReference: 'Tenant code',
      tenantPhone: 'Tel',
    })
  })

  it('is deterministic: the same headings always give the same mapping', () => {
    const columns = ['Prop Code', 'Unit No', 'Unit Size']
    expect(suggestPortfolioImportMapping([...columns], 'properties')).toEqual(suggestPortfolioImportMapping(columns, 'properties'))
  })

  it('never recognises one heading for two fields', () => {
    for (const scope of ['properties', 'units'] as const) {
      const keys = new Set<string>(portfolioImportFieldsFor(scope).map((field) => field.key))
      const owner = new Map<string, string>()
      for (const field of PORTFOLIO_IMPORT_FIELD_KEYS) {
        if (!keys.has(field)) continue
        for (const heading of PORTFOLIO_IMPORT_HEADER_SYNONYMS[field]) {
          const key = normalizePortfolioHeader(heading)
          if (scope === 'units' && field === 'floorAreaSqm') continue
          expect(owner.get(key) ?? field, `${scope}: ${heading}`).toBe(field)
          owner.set(key, field)
        }
      }
    }
  })
})

describe('portfolioImportHeaderSignature', () => {
  it('ignores case and surrounding spaces but keeps the order', () => {
    expect(portfolioImportHeaderSignature([' Unit No', 'AREA'])).toBe(portfolioImportHeaderSignature(['unit no', 'area ']))
    expect(portfolioImportHeaderSignature(['A', 'B'])).not.toBe(portfolioImportHeaderSignature(['B', 'A']))
  })
})

describe('portfolioImportMappingProblems', () => {
  const columns = ['Code', 'Name', 'Unit']
  it('accepts a mapping of known fields to columns of the file', () => {
    expect(portfolioImportMappingProblems({ propertyCode: 'Code', unitNumber: 'Unit' }, columns, 'properties')).toEqual([])
  })
  it('refuses a missing column, a column read twice and a property field when importing units', () => {
    expect(portfolioImportMappingProblems({ propertyCode: 'Code', propertyName: 'Code', city: 'Town' }, columns, 'properties')).toEqual([
      'The column "Code" is chosen for both Property code and Property name',
      'The file has no column "Town"',
    ])
    expect(portfolioImportMappingProblems({ propertyCode: 'Code' }, columns, 'units')).toEqual(['propertyCode is not imported with units of one property'])
  })
  it('keeps only the applicable entries of a saved mapping', () => {
    expect(applicablePortfolioImportMapping({ propertyCode: 'Code', unitNumber: 'Gone', unitType: 'Unit' }, columns, 'units')).toEqual({ unitType: 'Unit' })
  })
})

describe('reading cells', () => {
  it('reads South African number notation and refuses what is unclear', () => {
    expect(readPortfolioNumber('12500')).toEqual({ ok: true, value: 12500 })
    expect(readPortfolioNumber('12 500')).toEqual({ ok: true, value: 12500 })
    expect(readPortfolioNumber('145.5')).toEqual({ ok: true, value: 145.5 })
    expect(readPortfolioNumber('145,5')).toEqual({ ok: true, value: 145.5 })
    expect(readPortfolioNumber('12 500,75 m²')).toEqual({ ok: true, value: 12500.75 })
    expect(readPortfolioNumber('12,500.75')).toEqual({ ok: true, value: 12500.75 })
    expect(readPortfolioNumber('12.500,75')).toEqual({ ok: true, value: 12500.75 })
    expect(readPortfolioNumber('1,250,000')).toEqual({ ok: true, value: 1250000 })
    expect(readPortfolioNumber('0.125')).toEqual({ ok: true, value: 0.125 })
    expect(readPortfolioNumber('12,500')).toMatchObject({ ok: false, message: expect.stringMatching(/unclear/) })
    expect(readPortfolioNumber('abc')).toEqual({ ok: false, message: '"abc" is not a number' })
    expect(readPortfolioNumber('-5')).toMatchObject({ ok: false })
    expect(readPortfolioNumber('1,2,3')).toMatchObject({ ok: false })
  })

  it('reads enum labels, values and usual synonyms', () => {
    expect(readPortfolioPropertyType('Shopping centre')).toEqual({ ok: true, value: 'shopping_centre' })
    expect(readPortfolioPropertyType('industrial_warehouse')).toEqual({ ok: true, value: 'industrial_warehouse' })
    expect(readPortfolioPropertyType('Warehouse')).toEqual({ ok: true, value: 'industrial_warehouse' })
    expect(readPortfolioPropertyType('Castle')).toMatchObject({ ok: false })
    expect(readPortfolioUnitType('LINE SHOP')).toEqual({ ok: true, value: 'line_shop' })
    expect(readPortfolioUnitType('Parking bay')).toEqual({ ok: true, value: 'parking' })
    expect(readPortfolioOccupancyStatus('Let')).toEqual({ ok: true, value: 'occupied' })
    expect(readPortfolioOccupancyStatus('under offer')).toEqual({ ok: true, value: 'under_offer' })
    expect(readPortfolioOccupancyStatus('Maybe')).toMatchObject({ ok: false })
  })

  it('reads provinces by name or abbreviation', () => {
    expect(readPortfolioProvince('Kwazulu Natal')).toEqual({ ok: true, value: 'KwaZulu-Natal' })
    expect(readPortfolioProvince('GP')).toEqual({ ok: true, value: 'Gauteng' })
    expect(readPortfolioProvince('western cape')).toEqual({ ok: true, value: 'Western Cape' })
    expect(readPortfolioProvince('Gautang')).toEqual({ ok: false, message: '"Gautang" is not a South African province' })
  })

  it('reads tenant business types, never guessing one a registration number does not state', () => {
    expect(readPortfolioBusinessType('(Pty) Ltd')).toEqual({ ok: true, value: 'pty_ltd' })
    expect(readPortfolioBusinessType('cc')).toEqual({ ok: true, value: 'close_corporation' })
    expect(readPortfolioBusinessType('Shop')).toMatchObject({ ok: false })
    expect(businessTypeFromRegistrationNumber('2015/123456/07')).toBe('pty_ltd')
    expect(businessTypeFromRegistrationNumber('1998 / 012345 / 23')).toBe('close_corporation')
    expect(businessTypeFromRegistrationNumber('2001/000001/08')).toBe('npc')
    expect(businessTypeFromRegistrationNumber('2001/000001/06')).toBeUndefined()
    expect(businessTypeFromRegistrationNumber('K2015123456')).toBeUndefined()
  })

  it('reads South African tenant phone numbers only', () => {
    expect(readPortfolioTenantPhone('082 123 4567')).toEqual({ ok: true, value: '+27821234567' })
    expect(readPortfolioTenantPhone('+27 (11) 555-0100')).toEqual({ ok: true, value: '+27115550100' })
    expect(readPortfolioTenantPhone('+44 20 7946 0958')).toMatchObject({ ok: false })
    expect(readPortfolioTenantPhone('12345')).toMatchObject({ ok: false })
  })

  it('compares tenant identifiers without case or spaces', () => {
    expect(portfolioTenantIdentifierKey(' 2015 / 123456 / 07 ')).toBe('2015/123456/07')
    expect(portfolioTenantIdentifierKey('msq-t012')).toBe('MSQ-T012')
  })

  it('puts back the leading zero a spreadsheet dropped from a postal code', () => {
    expect(readPortfolioPostalCode('181')).toBe('0181')
    expect(readPortfolioPostalCode(' 2196 ')).toBe('2196')
    expect(readPortfolioPostalCode('21')).toBe('21')
  })
})
