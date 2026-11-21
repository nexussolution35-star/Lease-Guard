import { createHash } from 'node:crypto'

import { UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs, type FakeResult, type RecordedQuery } from '../../../common/testing/fake-db.test-helpers'
import { headerSignatureHash, PortfolioImportPreviewService } from './portfolio-import-preview.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const IMPORT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const COLUMNS = ['Prop Code', 'Prop Name', 'Unit No', 'Unit Size', 'Notes']

const batchRow = (overrides: Record<string, unknown> = {}) => ({
  id: IMPORT,
  company_id: COMPANY,
  scope: 'properties',
  property_id: null,
  file_name: 'rent-roll.csv',
  columns: COLUMNS,
  column_mapping: null,
  row_count: 3,
  ...overrides,
})

const PROPERTY = {
  id: 'p-msq',
  code: 'MSQ',
  name: 'Market Square',
  type: 'shopping_centre',
  status: 'active',
  address_line1: '12 Main Road',
  address_line2: null,
  suburb: 'Rosebank',
  city: 'Johannesburg',
  province: 'Gauteng',
  postal_code: '2196',
  gross_lettable_area_sqm: 12500,
}
const UNIT = { id: 'u-1', property_id: 'p-msq', unit_number: 'Shop 1', type: 'line_shop', floor_area_sqm: 80, occupancy_status: 'vacant' }

function respond(tables: Record<string, FakeResult>) {
  return (q: RecordedQuery): FakeResult => tables[q.table] ?? { data: null, error: null }
}

describe('PortfolioImportPreviewService.getMapping', () => {
  it('suggests a mapping from the headings when none is applied or saved', async () => {
    const db = fakeDb(respond({ portfolio_imports: { data: batchRow(), error: null } }))
    const mapping = await new PortfolioImportPreviewService().getMapping(db.client, COMPANY, IMPORT)
    expect(mapping.source).toBe('suggested')
    expect(mapping.fields.filter((f) => f.column)).toEqual([
      { field: 'propertyCode', column: 'Prop Code', suggestedColumn: 'Prop Code' },
      { field: 'propertyName', column: 'Prop Name', suggestedColumn: 'Prop Name' },
      { field: 'unitNumber', column: 'Unit No', suggestedColumn: 'Unit No' },
      { field: 'floorAreaSqm', column: 'Unit Size', suggestedColumn: 'Unit Size' },
    ])
    expect(mapping.fields).toHaveLength(22)
    const lookup = db.queries.find((q) => q.table === 'portfolio_import_mappings')!
    expect(lookup.calls).toContainEqual(['eq', ['header_signature', headerSignatureHash(COLUMNS)]])
    expect(lookup.calls).toContainEqual(['eq', ['company_id', COMPANY]])
    expect(lookup.calls).toContainEqual(['eq', ['scope', 'properties']])
  })

  it("reuses the company's saved mapping for the same headings", async () => {
    const db = fakeDb(
      respond({
        portfolio_imports: { data: batchRow(), error: null },
        portfolio_import_mappings: { data: { column_mapping: { propertyCode: 'Prop Code', propertyName: 'Notes' }, saved_at: '2026-11-19T08:00:00Z' }, error: null },
      }),
    )
    const mapping = await new PortfolioImportPreviewService().getMapping(db.client, COMPANY, IMPORT)
    expect(mapping).toMatchObject({ source: 'saved', savedAt: '2026-11-19T08:00:00Z' })
    expect(mapping.fields.find((f) => f.field === 'propertyName')).toEqual({ field: 'propertyName', column: 'Notes', suggestedColumn: 'Prop Name' })
    expect(mapping.fields.find((f) => f.field === 'unitNumber')!.column).toBeUndefined()
  })

  it('uses the mapping applied to the batch without looking up a saved one', async () => {
    const db = fakeDb(respond({ portfolio_imports: { data: batchRow({ column_mapping: { unitNumber: 'Notes' } }), error: null } }))
    const mapping = await new PortfolioImportPreviewService().getMapping(db.client, COMPANY, IMPORT)
    expect(mapping.source).toBe('applied')
    expect(mapping.fields.filter((f) => f.column).map((f) => [f.field, f.column])).toEqual([['unitNumber', 'Notes']])
    expect(db.queries.map((q) => q.table)).toEqual(['portfolio_imports'])
  })
})

describe('PortfolioImportPreviewService.saveMapping', () => {
  it('applies the mapping and saves it under the hash of the headings', async () => {
    const saved = batchRow({ column_mapping: { propertyCode: 'Prop Code', unitNumber: 'Unit No' } })
    const db = fakeDb(respond({ portfolio_imports: { data: batchRow(), error: null }, 'rpc:save_portfolio_import_mapping': { data: saved, error: null } }))
    const mapping = await new PortfolioImportPreviewService().saveMapping(db.client, COMPANY, IMPORT, { propertyCode: 'Prop Code', unitNumber: 'Unit No' })
    expect(rpcArgs(db.queries[1]!)).toEqual({
      p_company_id: COMPANY,
      p_import_id: IMPORT,
      p_header_signature: createHash('sha256').update('prop code\u001fprop name\u001funit no\u001funit size\u001fnotes').digest('hex'),
      p_mapping: { propertyCode: 'Prop Code', unitNumber: 'Unit No' },
    })
    expect(mapping.source).toBe('applied')
  })

  it('refuses a column the file does not have, a column chosen twice and a property field for a units batch', async () => {
    const service = new PortfolioImportPreviewService()
    const db = fakeDb(respond({ portfolio_imports: { data: batchRow(), error: null } }))
    await expect(service.saveMapping(db.client, COMPANY, IMPORT, { propertyCode: 'Code' })).rejects.toThrow(UnprocessableEntityException)
    await expect(service.saveMapping(db.client, COMPANY, IMPORT, { propertyCode: 'Notes', propertyName: 'Notes' })).rejects.toThrow(UnprocessableEntityException)
    const units = fakeDb(respond({ portfolio_imports: { data: batchRow({ scope: 'units', property_id: 'p-msq' }), error: null } }))
    await expect(service.saveMapping(units.client, COMPANY, IMPORT, { propertyCode: 'Prop Code' })).rejects.toThrow(UnprocessableEntityException)
    expect([...db.queries, ...units.queries].some((q) => q.table.startsWith('rpc:'))).toBe(false)
  })
})

describe('PortfolioImportPreviewService.preview', () => {
  const rows = [
    { row_number: 2, cells: ['MSQ', 'Market Square', 'Shop 1', '80', ''] },
    { row_number: 3, cells: ['MSQ', 'Market Square', 'Shop 2', '95', ''] },
    { row_number: 4, cells: ['MSQ', 'Market Square', 'Shop 1', '80', ''] },
    { row_number: 5, cells: ['', '', '', '', 'only a note'] },
  ]
  const tables = {
    portfolio_imports: { data: batchRow(), error: null },
    portfolio_import_rows: { data: rows, error: null },
    properties: { data: [PROPERTY], error: null },
    units: { data: [UNIT], error: null },
  }

  it('checks every row against the company’s properties and units, counts the results and pages the rows asked for', async () => {
    const db = fakeDb(respond(tables))
    const service = new PortfolioImportPreviewService()
    const preview = await service.preview(db.client, COMPANY, IMPORT, { page: 1, pageSize: 25 })
    expect(preview.counts).toEqual({ new: 0, match: 1, suggested: 0, conflict: 0, invalid: 2, duplicate: 1, skipped: 0 })
    expect(preview.items.map((r) => [r.rowNumber, r.result])).toEqual([
      [2, 'match'],
      [3, 'invalid'],
      [4, 'duplicate'],
      [5, 'invalid'],
    ])
    // No unit type column: a new unit cannot be created without one.
    expect(preview.items[1]!.reasons).toEqual(['Unit type is missing'])
    expect(preview.total).toBe(4)

    const invalid = await service.preview(db.client, COMPANY, IMPORT, { result: 'invalid', page: 2, pageSize: 1 })
    expect(invalid).toMatchObject({ total: 2, page: 2, pageSize: 1, counts: preview.counts })
    expect(invalid.items.map((r) => r.rowNumber)).toEqual([5])

    for (const table of ['properties', 'units', 'portfolio_import_rows']) {
      expect(db.queries.find((q) => q.table === table)!.calls).toContainEqual(['eq', ['company_id', COMPANY]])
    }
  })

  it("reads only the batch's property and its units for a units batch", async () => {
    const db = fakeDb(respond({ ...tables, portfolio_imports: { data: batchRow({ scope: 'units', property_id: 'p-msq', columns: ['Unit No', 'Unit Size'] }), error: null } }))
    await new PortfolioImportPreviewService().preview(db.client, COMPANY, IMPORT, { page: 1, pageSize: 25 })
    expect(db.queries.find((q) => q.table === 'properties')!.calls).toContainEqual(['eq', ['id', 'p-msq']])
    expect(db.queries.find((q) => q.table === 'units')!.calls).toContainEqual(['eq', ['property_id', 'p-msq']])
  })
})

describe('PortfolioImportPreviewService.changeRow', () => {
  const APPLIED = { propertyCode: 'Prop Code', propertyName: 'Prop Name', unitNumber: 'Unit No', floorAreaSqm: 'Unit Size' }
  const stored = { row_number: 2, cells: ['MSQ', 'Market Square', 'Shop 1', '80', ''] }

  /** The row lookup and the update answer one row; the full row list answers the rows as stored after the change. */
  function rowsDb(batch: Record<string, unknown>, after: Record<string, unknown>, extra: Record<string, FakeResult> = {}) {
    return fakeDb((q) => {
      const single = q.calls.some(([method]) => method === 'maybeSingle')
      if (q.table === 'units' && single) return { data: { property_id: 'p-msq' }, error: null }
      if (q.table === 'tenants') return single ? (extra.tenants ?? { data: null, error: null }) : { data: [], error: null }
      if (q.table === 'portfolio_import_rows') {
        return single ? { data: { corrections: {}, row_number: 2 }, error: null } : { data: [{ ...stored, ...after }], error: null }
      }
      return (
        extra[q.table] ??
        { portfolio_imports: { data: batch, error: null }, properties: { data: [PROPERTY], error: null }, units: { data: [UNIT], error: null } }[q.table] ?? {
          data: null,
          error: null,
        }
      )
    })
  }

  it('stores a correction on the batch row only and returns the row checked again with it', async () => {
    const db = rowsDb(batchRow({ column_mapping: APPLIED }), {
      corrections: { floorAreaSqm: '95' },
      skipped: false,
      linked_property_id: null,
      linked_unit_id: null,
      changed_by_user_id: 'user-naledi',
      changed_at: '2026-11-21T08:00:00Z',
    })
    const checked = await new PortfolioImportPreviewService().changeRow(db.client, COMPANY, IMPORT, 2, { corrections: { floorAreaSqm: ' 95 ' } })

    const update = db.queries.find((q) => q.table === 'portfolio_import_rows' && q.calls.some(([method]) => method === 'update'))!
    expect(update.calls).toContainEqual(['update', [{ corrections: { floorAreaSqm: '95' } }]])
    expect(update.calls).toContainEqual(['eq', ['company_id', COMPANY]])
    expect(update.calls).toContainEqual(['eq', ['row_number', 2]])
    // Nothing is written anywhere else: no property, unit or other table is changed.
    expect(db.queries.filter((q) => q.calls.some(([method]) => ['update', 'insert', 'upsert', 'delete'].includes(method))).map((q) => q.table)).toEqual([
      'portfolio_import_rows',
    ])
    expect(checked).toMatchObject({
      rowNumber: 2,
      result: 'conflict',
      conflicts: [{ field: 'floorAreaSqm', value: '95', existingValue: '80' }],
      resolution: { corrections: [{ field: 'floorAreaSqm', value: '95', fileValue: '80' }], changedByUserId: 'user-naledi' },
    })
  })

  it('applies a saved or suggested mapping to the batch before the first correction', async () => {
    const db = rowsDb(batchRow(), { corrections: { propertyName: 'Market Sq' }, skipped: false, changed_at: '2026-11-21T08:00:00Z' }, {
      'rpc:save_portfolio_import_mapping': { data: batchRow({ column_mapping: APPLIED }), error: null },
    })
    await new PortfolioImportPreviewService().changeRow(db.client, COMPANY, IMPORT, 2, { corrections: { propertyName: 'Market Sq' } })
    const tables = db.queries.map((q) => q.table)
    expect(tables.indexOf('rpc:save_portfolio_import_mapping')).toBeGreaterThan(-1)
    expect(tables.indexOf('rpc:save_portfolio_import_mapping')).toBeLessThan(
      db.queries.findIndex((q) => q.calls.some(([method]) => method === 'update')),
    )
  })

  it('links a unit together with its property and skips without touching the mapping', async () => {
    const db = rowsDb(batchRow(), { skipped: false, linked_property_id: 'p-msq', linked_unit_id: 'u-1', changed_at: '2026-11-21T08:00:00Z' })
    const checked = await new PortfolioImportPreviewService().changeRow(db.client, COMPANY, IMPORT, 2, { link: { unitId: 'u-1' }, skipped: false })
    const update = db.queries.find((q) => q.calls.some(([method]) => method === 'update'))!
    expect(update.calls).toContainEqual(['update', [{ skipped: false, linked_property_id: 'p-msq', linked_unit_id: 'u-1' }]])
    expect(db.queries.some((q) => q.table === 'rpc:save_portfolio_import_mapping')).toBe(false)
    expect(checked).toMatchObject({ result: 'match', resolution: { linkedProperty: { id: 'p-msq' }, linkedUnit: { id: 'u-1' } } })
  })

  it("confirms a row's tenant as a tenant of the workspace, rejects suggestions, and refuses a tenant of another workspace", async () => {
    const service = new PortfolioImportPreviewService()
    const confirm = rowsDb(batchRow(), { linked_tenant_id: 't-1', changed_at: '2026-11-21T08:00:00Z' }, { tenants: { data: { id: 't-1' }, error: null } })
    await service.changeRow(confirm.client, COMPANY, IMPORT, 2, { tenantMatch: { decision: 'confirmed', tenantId: 't-1' } })
    const tenantLookup = confirm.queries.find((q) => q.table === 'tenants' && q.calls.some(([method]) => method === 'maybeSingle'))!
    expect(tenantLookup.calls).toContainEqual(['eq', ['company_id', COMPANY]])
    expect(confirm.queries.find((q) => q.calls.some(([method]) => method === 'update'))!.calls).toContainEqual([
      'update',
      [{ linked_tenant_id: 't-1', tenant_suggestions_rejected: false }],
    ])

    const reject = rowsDb(batchRow(), { tenant_suggestions_rejected: true, changed_at: '2026-11-21T08:00:00Z' })
    await service.changeRow(reject.client, COMPANY, IMPORT, 2, { tenantMatch: { decision: 'rejected' } })
    expect(reject.queries.find((q) => q.calls.some(([method]) => method === 'update'))!.calls).toContainEqual([
      'update',
      [{ linked_tenant_id: null, tenant_suggestions_rejected: true }],
    ])

    const elsewhere = rowsDb(batchRow(), {}, { tenants: { data: null, error: null } })
    await expect(service.changeRow(elsewhere.client, COMPANY, IMPORT, 2, { tenantMatch: { decision: 'confirmed', tenantId: 't-9' } })).rejects.toThrow(
      UnprocessableEntityException,
    )
    expect(elsewhere.queries.some((q) => q.calls.some(([method]) => method === 'update'))).toBe(false)
  })

  it('refuses a property field for a units import, a property link for a units import, and an empty change', async () => {
    const service = new PortfolioImportPreviewService()
    const units = rowsDb(batchRow({ scope: 'units', property_id: 'p-msq' }), {})
    await expect(service.changeRow(units.client, COMPANY, IMPORT, 2, { corrections: { propertyName: 'X' } })).rejects.toThrow(UnprocessableEntityException)
    await expect(service.changeRow(units.client, COMPANY, IMPORT, 2, { link: { propertyId: 'p-msq' } })).rejects.toThrow(UnprocessableEntityException)
    await expect(service.changeRow(units.client, COMPANY, IMPORT, 2, {})).rejects.toThrow(UnprocessableEntityException)
    expect(units.queries.some((q) => q.calls.some(([method]) => method === 'update'))).toBe(false)
  })
})
