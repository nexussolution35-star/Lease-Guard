import { describe, expect, it } from 'vitest'

import { checkPortfolioRows, type ExistingProperty, type ExistingUnit } from '../preview/check-rows'
import { plannedPropertyBody, plannedTenantBody, plannedUnitBody, planPortfolioImport } from './plan-import'

const COLUMNS = ['Code', 'Name', 'Type', 'Street', 'Suburb', 'City', 'Province', 'Postal code', 'GLA', 'Unit', 'Unit type', 'Area', 'Status']
const MAPPING = {
  propertyCode: 'Code',
  propertyName: 'Name',
  propertyType: 'Type',
  addressLine1: 'Street',
  suburb: 'Suburb',
  city: 'City',
  province: 'Province',
  postalCode: 'Postal code',
  grossLettableAreaSqm: 'GLA',
  unitNumber: 'Unit',
  unitType: 'Unit type',
  floorAreaSqm: 'Area',
  occupancyStatus: 'Status',
} as const

const MSQ: ExistingProperty = {
  id: 'p-msq',
  code: 'MSQ',
  name: 'Maponya Square',
  type: 'shopping_centre',
  status: 'active',
  addressLine1: '2 Chris Hani Road',
  addressLine2: null,
  suburb: 'Soweto',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '1804',
  grossLettableAreaSqm: 12000,
}
const S01: ExistingUnit = { id: 'u-s01', propertyId: 'p-msq', unitNumber: 'S01', type: 'line_shop', floorAreaSqm: 120, occupancyStatus: 'occupied' }

const msqRow = (unit: string, area: string) => ['MSQ', 'Maponya Square', 'Shopping centre', '2 Chris Hani Road', 'Soweto', 'Johannesburg', 'Gauteng', '1804', '12000', unit, 'Line shop', area, 'Occupied']
const parkRow = (unit: string) => ['RBP', 'Rosebank Park', 'Office', '5 Bath Avenue', 'Rosebank', 'Johannesburg', 'gauteng', '2196', '4 000', unit, 'Office suite', '150,5', 'Vacant']

function check(rows: string[][], skipped: number[] = []) {
  return checkPortfolioRows({
    scope: 'properties',
    columns: COLUMNS,
    mapping: MAPPING,
    rows: rows.map((cells, index) => ({
      rowNumber: index + 2,
      cells,
      ...(skipped.includes(index + 2) ? { resolution: { corrections: {}, skipped: true, changedAt: '2026-11-21T08:00:00Z' } } : {}),
    })),
    properties: [MSQ],
    units: [S01],
  })
}

describe('planPortfolioImport', () => {
  it('creates each new property once, from the first row naming it, with every new unit; matches are linked, not created', () => {
    const rows = check([msqRow('S01', '120'), msqRow('S02', '90'), parkRow('A1'), parkRow('A2')])
    expect(rows.map((row) => row.result)).toEqual(['match', 'new', 'new', 'new'])

    const plan = planPortfolioImport({ scope: 'properties', rows })
    expect(plan).toMatchObject({ linkedRows: 1, skippedRows: 0, blockedRows: 0 })
    expect(plan.properties).toEqual([
      {
        rowNumber: 4,
        code: 'RBP',
        values: {
          propertyCode: 'RBP',
          propertyName: 'Rosebank Park',
          propertyType: 'office',
          addressLine1: '5 Bath Avenue',
          suburb: 'Rosebank',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '2196',
          grossLettableAreaSqm: 4000,
        },
      },
    ])
    expect(plan.units.map((unit) => [unit.rowNumber, unit.propertyId ?? unit.propertyCode, unit.values.unitNumber])).toEqual([
      [3, 'p-msq', 'S02'],
      [4, 'RBP', 'A1'],
      [5, 'RBP', 'A2'],
    ])
    expect(plan.units[1]!.values).toEqual({ unitNumber: 'A1', unitType: 'office_suite', floorAreaSqm: 150.5, occupancyStatus: 'vacant' })
  })

  it('leaves skipped rows and rows still blocked out, and counts them', () => {
    const rows = check([msqRow('S01', '95'), msqRow('S02', 'ninety'), parkRow('A1'), parkRow('A1'), parkRow('A3')], [6])
    expect(rows.map((row) => row.result)).toEqual(['conflict', 'invalid', 'new', 'duplicate', 'skipped'])
    const plan = planPortfolioImport({ scope: 'properties', rows })
    expect(plan).toMatchObject({ linkedRows: 0, skippedRows: 1, blockedRows: 3 })
    expect(plan.units.map((unit) => unit.values.unitNumber)).toEqual(['A1'])
  })

  it('adds the units of a units import to its property', () => {
    const rows = checkPortfolioRows({
      scope: 'units',
      propertyId: 'p-msq',
      columns: ['Unit', 'Unit type', 'Area'],
      mapping: { unitNumber: 'Unit', unitType: 'Unit type', floorAreaSqm: 'Area' },
      rows: [
        { rowNumber: 2, cells: ['S01', 'Line shop', '120'] },
        { rowNumber: 3, cells: ['S09', 'Kiosk', '12'] },
      ],
      properties: [MSQ],
      units: [S01],
    })
    const plan = planPortfolioImport({ scope: 'units', propertyId: 'p-msq', rows })
    expect(plan.properties).toEqual([])
    expect(plan.units).toEqual([{ rowNumber: 3, propertyId: 'p-msq', values: { unitNumber: 'S09', unitType: 'kiosk', floorAreaSqm: 12 } }])
  })

  it('is empty once everything the file names exists: approving again creates nothing', () => {
    const plan = planPortfolioImport({ scope: 'properties', rows: check([msqRow('S01', '120')]) })
    expect(plan.properties.length + plan.units.length).toBe(0)
    expect(plan.linkedRows).toBe(1)
  })
})

describe('plannedPropertyBody and plannedUnitBody', () => {
  it('build the property and unit forms\' create bodies, held to their validation', () => {
    const plan = planPortfolioImport({ scope: 'properties', rows: check([parkRow('A1')]) })
    const property = plannedPropertyBody(plan.properties[0]!, { managerUserId: '10000000-0000-4000-8000-000000000003', accountingSystem: 'MRI' })
    expect(property).toEqual({
      body: {
        name: 'Rosebank Park',
        code: 'RBP',
        type: 'office',
        status: 'active',
        address: { line1: '5 Bath Avenue', suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196' },
        grossLettableAreaSqm: 4000,
        managerUserId: '10000000-0000-4000-8000-000000000003',
        accountingSystem: 'MRI',
      },
    })
    const unit = plannedUnitBody(plan.units[0]!, '30000000-0000-4000-8000-000000000001')
    expect(unit).toEqual({
      body: { propertyId: '30000000-0000-4000-8000-000000000001', unitNumber: 'A1', type: 'office_suite', floorAreaSqm: 150.5, occupancyStatus: 'vacant' },
    })
    expect(plannedUnitBody({ rowNumber: 9, values: { unitNumber: 'X' } }, '30000000-0000-4000-8000-000000000001')).toEqual({
      problem: expect.stringMatching(/^Row 9: /),
    })
  })
})

describe('planPortfolioImport: tenants from the register', () => {
  const columns = [...COLUMNS, 'Tenant', 'Registered name', 'Reg no', 'Contact person', 'Email', 'Phone']
  const mapping = { ...MAPPING, tenantTradingName: 'Tenant', tenantLegalName: 'Registered name', tenantRegistrationNumber: 'Reg no', tenantContactPerson: 'Contact person', tenantEmail: 'Email', tenantPhone: 'Phone' } as const
  const plan = (rows: string[][]) =>
    planPortfolioImport({
      scope: 'properties',
      rows: checkPortfolioRows({
        scope: 'properties',
        columns,
        mapping,
        rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
        properties: [MSQ],
        units: [S01],
        tenants: [{ id: 't-1', tradingName: 'Soweto Shoes', legalName: 'Soweto Shoes (Pty) Ltd', registrationNumber: '2010/000001/07', accountReference: null }],
      }),
    })
  const bean = ['Bean There', 'Bean There Coffee (Pty) Ltd', '2015/123456/07', 'Thandi Mokoena', '', '082 123 4567']

  it('creates a new tenant once for the units it names, in existing and new units and properties', () => {
    const result = plan([
      [...msqRow('S01', '120'), ...bean],
      [...msqRow('S02', '80'), ...bean],
      [...parkRow('A1'), 'Kwik Print', 'Kwik Print CC', '1998/012345/23', 'Sipho', 'sipho@kwik.co.za', '0831112222'],
      [...msqRow('S03', '60'), 'Soweto Shoes', '', '2010/000001/07', '', '', ''],
    ])
    expect(result.tenants.map(({ rowNumber, unitId, propertyId, propertyCode, unitNumber }) => ({ rowNumber, unitId, propertyId, propertyCode, unitNumber }))).toEqual([
      { rowNumber: 2, unitId: 'u-s01', propertyId: undefined, propertyCode: undefined, unitNumber: undefined },
      { rowNumber: 4, unitId: undefined, propertyId: undefined, propertyCode: 'RBP', unitNumber: 'A1' },
    ])
    expect(result).toMatchObject({ tenantsLinked: 1, tenantSuggestionsToReview: 0, blockedRows: 0 })
    expect(result.missingContactDetails).toEqual([{ rowNumber: 2, tenantName: 'Bean There', missing: ['email'], blocksCreation: false }])

    const body = plannedTenantBody(result.tenants[0]!)
    expect(body).toEqual({
      body: expect.objectContaining({
        legalName: 'Bean There Coffee (Pty) Ltd',
        tradingName: 'Bean There',
        businessType: 'pty_ltd',
        registrationNumber: '2015/123456/07',
        primaryContact: expect.objectContaining({ fullName: 'Thandi Mokoena', phone: '+27821234567' }),
        whatsappNumber: '+27821234567',
      }),
    })
    expect(plannedTenantBody(result.tenants[1]!)).toMatchObject({ body: { businessType: 'close_corporation', email: 'sipho@kwik.co.za' } })
  })

  it('keeps a tenant whose suggested match waits on the manager out, and lists tenants that cannot be created for missing contacts', () => {
    const result = plan([
      [...msqRow('S01', '120'), 'Soweto Shoes Outlet', 'Soweto Shoes Outlet (Pty) Ltd', '', 'Lerato', '', '0821112222'],
      [...msqRow('S02', '80'), 'Bean There', 'Bean There (Pty) Ltd', '2015/123456/07', '', '', ''],
    ])
    expect(result.tenants).toEqual([])
    expect(result).toMatchObject({ tenantSuggestionsToReview: 1, blockedRows: 2 })
    expect(result.missingContactDetails).toEqual([
      { rowNumber: 3, tenantName: 'Bean There', missing: ['contactPerson', 'email', 'phone'], blocksCreation: true },
    ])
  })
})
