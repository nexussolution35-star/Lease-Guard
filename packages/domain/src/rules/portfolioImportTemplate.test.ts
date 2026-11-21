import { describe, expect, it } from 'vitest'

import { PORTFOLIO_IMPORT_FIELDS, portfolioImportFieldsFor, portfolioImportTemplateCsv } from './portfolioImportTemplate.js'

describe('portfolio import template', () => {
  it('lists every supported column with one example row for properties and their units', () => {
    const lines = portfolioImportTemplateCsv('properties').split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
    expect(lines[0]).toBe(
      'Property code,Property name,Property type,Address line 1,Address line 2,Suburb,City,Province,Postal code,' +
        'Gross lettable area (m²),Unit number,Unit type,Floor area (m²),Unit status,' +
        'Tenant trading name,Tenant registered name,Tenant registration number,Tenant account reference,Tenant business type,' +
        'Tenant contact person,Tenant email,Tenant phone',
    )
    expect(lines[1]).toBe(
      'MSQ,Market Square,Shopping centre,12 Main Road,,Rosebank,Johannesburg,Gauteng,2196,12500,Shop 12,Line shop,145.5,Occupied,' +
        'Bean There Coffee,Bean There Coffee (Pty) Ltd,2015/123456/07,MSQ-T012,Pty Ltd,Thandi Mokoena,accounts@beanthere.co.za,082 123 4567',
    )
    expect(lines[0]!.split(',')).toHaveLength(PORTFOLIO_IMPORT_FIELDS.length)
    expect(lines[1]!.split(',')).toHaveLength(PORTFOLIO_IMPORT_FIELDS.length)
  })

  it('lists only the unit and tenant columns for units of one property', () => {
    expect(portfolioImportFieldsFor('units').map((field) => field.key)).toEqual([
      'unitNumber',
      'unitType',
      'floorAreaSqm',
      'occupancyStatus',
      'tenantTradingName',
      'tenantLegalName',
      'tenantRegistrationNumber',
      'tenantAccountReference',
      'tenantBusinessType',
      'tenantContactPerson',
      'tenantEmail',
      'tenantPhone',
    ])
    expect(portfolioImportTemplateCsv('units').split('\r\n')[0]).toBe(
      'Unit number,Unit type,Floor area (m²),Unit status,Tenant trading name,Tenant registered name,Tenant registration number,' +
        'Tenant account reference,Tenant business type,Tenant contact person,Tenant email,Tenant phone',
    )
  })

  it('has unique keys and headings', () => {
    expect(new Set(PORTFOLIO_IMPORT_FIELDS.map((field) => field.key)).size).toBe(PORTFOLIO_IMPORT_FIELDS.length)
    expect(new Set(PORTFOLIO_IMPORT_FIELDS.map((field) => field.header.toLowerCase())).size).toBe(PORTFOLIO_IMPORT_FIELDS.length)
  })
})
