import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs, type FakeResult, type RecordedQuery } from '../../../common/testing/fake-db.test-helpers'
import { PortfolioImportPreviewService } from '../preview/portfolio-import-preview.service'
import { PortfolioImportApplyService } from './portfolio-import-apply.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const IMPORT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000a1'
const COLUMNS = ['Code', 'Name', 'Type', 'Street', 'Suburb', 'City', 'Province', 'Postal code', 'GLA', 'Unit', 'Unit type', 'Area']
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
}

const batchRow = (overrides: Record<string, unknown> = {}) => ({
  id: IMPORT,
  company_id: COMPANY,
  scope: 'properties',
  property_id: null,
  file_name: 'portfolio.csv',
  columns: COLUMNS,
  column_mapping: MAPPING,
  row_count: 3,
  approved_by_user_id: null,
  approved_at: null,
  ...overrides,
})

const PROPERTY = {
  id: '6f1d2c1e-0000-4000-8000-0000000000b1',
  code: 'MSQ',
  name: 'Maponya Square',
  type: 'shopping_centre',
  status: 'active',
  address_line1: '2 Chris Hani Road',
  address_line2: null,
  suburb: 'Soweto',
  city: 'Johannesburg',
  province: 'Gauteng',
  postal_code: '1804',
  gross_lettable_area_sqm: 12000,
}

const ROWS = [
  { row_number: 2, cells: ['RBP', 'Rosebank Park', 'Office', '5 Bath Avenue', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', '4000', 'A1', 'Office suite', '150'] },
  { row_number: 3, cells: ['RBP', 'Rosebank Park', 'Office', '5 Bath Avenue', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', '4000', 'A2', 'Office suite', '90'] },
  { row_number: 4, cells: ['MSQ', '', '', '', '', '', '', '', '', 'S09', 'Kiosk', '12'] },
]

function database(options: { units?: unknown[]; rpc?: FakeResult[]; batch?: Record<string, unknown> } = {}) {
  const rpcResults = [...(options.rpc ?? [{ data: batchRow(), error: null }])]
  return fakeDb((q: RecordedQuery): FakeResult => {
    switch (q.table) {
      case 'portfolio_imports':
        return { data: batchRow(options.batch), error: null }
      case 'portfolio_import_rows':
        return { data: ROWS, error: null }
      case 'properties':
        return { data: [PROPERTY], error: null }
      case 'units':
        return { data: options.units ?? [], error: null }
      case 'portfolio_import_records':
        return { data: [], error: null }
      case 'rpc:apply_portfolio_import':
        return rpcResults.shift() ?? { data: batchRow(), error: null }
      default:
        return { data: null, error: null }
    }
  })
}

const service = () => new PortfolioImportApplyService(new PortfolioImportPreviewService())

describe('PortfolioImportApplyService.summary', () => {
  it('counts the properties and units approving creates, and writes nothing', async () => {
    const db = database()
    const summary = await service().summary(db.client, COMPANY, IMPORT)
    expect(summary).toEqual({
      importId: IMPORT,
      propertiesToCreate: 1,
      unitsToCreate: 3,
      tenantsToCreate: 0,
      tenantsLinked: 0,
      tenantSuggestionsToReview: 0,
      missingContactDetails: [],
      linkedRows: 0,
      skippedRows: 0,
      blockedRows: 0,
      canApprove: true,
      needsAccountingSystem: true,
      created: [],
    })
    expect(db.queries.some((q) => q.table.startsWith('rpc:') || q.calls.some(([method]) => ['insert', 'update'].includes(method)))).toBe(false)
  })
})

describe('PortfolioImportApplyService.approve', () => {
  it('creates the new records in one database call with the forms\' insert columns, the approver as manager', async () => {
    const db = database()
    await service().approve(db.client, COMPANY, IMPORT, { userId: MANAGER, accountingSystem: 'MRI' })
    const calls = db.queries.filter((q) => q.table === 'rpc:apply_portfolio_import')
    expect(calls).toHaveLength(1)
    const args = rpcArgs(calls[0]!) as { p_properties: Record<string, unknown>[]; p_units: Record<string, unknown>[] }
    expect(args).toMatchObject({ p_company_id: COMPANY, p_import_id: IMPORT })
    expect(args.p_properties).toEqual([
      {
        row_number: 2,
        company_id: COMPANY,
        name: 'Rosebank Park',
        code: 'RBP',
        type: 'office',
        status: 'active',
        address_line1: '5 Bath Avenue',
        address_line2: null,
        suburb: 'Rosebank',
        city: 'Johannesburg',
        province: 'Gauteng',
        postal_code: '2196',
        description: '',
        gross_lettable_area_sqm: 4000,
        manager_user_id: MANAGER,
        owner_user_id: null,
        accounting_system: 'MRI',
      },
    ])
    expect(args.p_units.map((unit) => [unit.row_number, unit.property_id, unit.property_code, unit.unit_number, unit.occupancy_status])).toEqual([
      [2, null, 'RBP', 'A1', 'vacant'],
      [3, null, 'RBP', 'A2', 'vacant'],
      [4, '6f1d2c1e-0000-4000-8000-0000000000b1', null, 'S09', 'vacant'],
    ])
    // Nothing is written outside the one transaction: no direct insert or update.
    expect(db.queries.some((q) => q.calls.some(([method]) => ['insert', 'update', 'upsert', 'delete'].includes(method)))).toBe(false)
  })

  it('needs the accounting system when it creates properties', async () => {
    const db = database()
    await expect(service().approve(db.client, COMPANY, IMPORT, { userId: MANAGER })).rejects.toThrow(UnprocessableEntityException)
    expect(db.queries.some((q) => q.table === 'rpc:apply_portfolio_import')).toBe(false)
  })

  it('creates nothing and returns the summary when everything already exists (approving twice)', async () => {
    const existing = [
      { ...PROPERTY, id: '6f1d2c1e-0000-4000-8000-0000000000b2', code: 'RBP', name: 'Rosebank Park', type: 'office', address_line1: '5 Bath Avenue', suburb: 'Rosebank', postal_code: '2196', gross_lettable_area_sqm: 4000 },
      PROPERTY,
    ]
    const units = [
      { id: 'u-a1', property_id: '6f1d2c1e-0000-4000-8000-0000000000b2', unit_number: 'A1', type: 'office_suite', floor_area_sqm: 150, occupancy_status: 'vacant' },
      { id: 'u-a2', property_id: '6f1d2c1e-0000-4000-8000-0000000000b2', unit_number: 'A2', type: 'office_suite', floor_area_sqm: 90, occupancy_status: 'vacant' },
      { id: 'u-s09', property_id: '6f1d2c1e-0000-4000-8000-0000000000b1', unit_number: 'S09', type: 'kiosk', floor_area_sqm: 12, occupancy_status: 'vacant' },
    ]
    const db = fakeDb((q) => {
      if (q.table === 'properties') return { data: existing, error: null }
      if (q.table === 'units') return { data: units, error: null }
      if (q.table === 'portfolio_import_rows') return { data: ROWS, error: null }
      if (q.table === 'portfolio_imports') return { data: batchRow({ approved_at: '2026-11-21T08:00:00Z', approved_by_user_id: MANAGER }), error: null }
      return { data: [], error: null }
    })
    const summary = await service().approve(db.client, COMPANY, IMPORT, { userId: MANAGER, accountingSystem: 'MRI' })
    expect(summary).toMatchObject({ propertiesToCreate: 0, unitsToCreate: 0, linkedRows: 3, canApprove: false, approval: { approvedByUserId: MANAGER } })
    expect(db.queries.some((q) => q.table === 'rpc:apply_portfolio_import')).toBe(false)
  })

  it('checks the rows again once when another approval created a record meanwhile, and then answers 409', async () => {
    const duplicate = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    const db = database({ rpc: [duplicate, duplicate] })
    await expect(service().approve(db.client, COMPANY, IMPORT, { userId: MANAGER, accountingSystem: 'MRI' })).rejects.toThrow(ConflictException)
    expect(db.queries.filter((q) => q.table === 'rpc:apply_portfolio_import')).toHaveLength(2)
  })
})
