import { createHash } from 'node:crypto'

import { BadRequestException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { fakeDb, rpcArgs, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { StorageService } from '../../infrastructure/storage/storage.service'
import { PORTFOLIO_IMPORTS_BUCKET } from './portfolio-imports.schemas'
import { PortfolioImportsService } from './portfolio-imports.service'
import { xlsx } from './spreadsheet/xlsx.test-helpers'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const OTHER = '6f1d2c1e-0000-4000-8000-000000000002'
const IMPORT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000e1'
const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000a1'

const CSV = Buffer.from('\ufeffProperty code;Property name\r\nMSQ;Market Square\r\n;\r\nKGP;Kgalagadi Park\r\n', 'utf8')
const PATH = `${COMPANY}/${IMPORT}/portfolio.csv`

const batchRow = (overrides: Record<string, unknown> = {}) => ({
  id: IMPORT,
  company_id: COMPANY,
  scope: 'properties',
  property_id: null,
  file_name: 'portfolio.csv',
  storage_path: PATH,
  file_format: 'csv',
  size_bytes: CSV.length,
  file_sha256: 'a'.repeat(64),
  sheet_name: null,
  sheet_names: [],
  delimiter: ';',
  columns: ['Property code', 'Property name'],
  row_count: 2,
  uploaded_by_user_id: MANAGER,
  uploaded_at: '2026-11-20T08:00:00+00:00',
  created_at: '2026-11-20T08:00:00+00:00',
  updated_at: '2026-11-20T08:00:00+00:00',
  ...overrides,
})

function fakeStorage(file: Buffer = CSV) {
  return {
    createSignedUploadUrl: vi.fn(async (_db: unknown, _bucket: string, path: string) => ({ signedUrl: `http://storage/${path}?token=t`, token: 't', path })),
    objectInfo: vi.fn(async () => ({ sizeBytes: file.length })),
    download: vi.fn(async () => new Blob([new Uint8Array(file)])),
  } as unknown as StorageService & Record<string, ReturnType<typeof vi.fn>>
}

const created = (q: RecordedQuery) => (q.table === 'rpc:create_portfolio_import' ? { data: batchRow(), error: null } : { data: null, error: null })

describe('PortfolioImportsService.createUploadUrl', () => {
  it('signs an upload into the portfolio-imports bucket and says which content type to send', async () => {
    const storage = fakeStorage()
    const target = await new PortfolioImportsService(storage).createUploadUrl(fakeDb(() => ({ data: null, error: null })).client, COMPANY, {
      fileName: 'Rent roll (Nov).xlsx',
      sizeBytes: 1024,
    })
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(expect.anything(), PORTFOLIO_IMPORTS_BUCKET, `${COMPANY}/${target.importId}/Rent-roll-Nov.xlsx`)
    expect(target).toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      maxSizeBytes: 5 * 1024 * 1024,
      storagePath: `${COMPANY}/${target.importId}/Rent-roll-Nov.xlsx`,
    })
  })

  it('refuses a file over 5 MB with 413', async () => {
    await expect(
      new PortfolioImportsService(fakeStorage()).createUploadUrl(fakeDb(() => ({ data: null, error: null })).client, COMPANY, {
        fileName: 'big.csv',
        sizeBytes: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(PayloadTooLargeException)
  })
})

describe('PortfolioImportsService.create', () => {
  const body = { scope: 'properties' as const, storagePath: PATH, fileName: 'portfolio.csv', sizeBytes: CSV.length }

  it('reads the stored CSV on the server and records the batch with its rows in one call', async () => {
    const db = fakeDb(created)
    const storage = fakeStorage()
    const batch = await new PortfolioImportsService(storage).create(db.client, COMPANY, body)

    expect(storage.download).toHaveBeenCalledWith(expect.anything(), PORTFOLIO_IMPORTS_BUCKET, PATH)
    expect(db.queries.map((q) => q.table)).toEqual(['rpc:create_portfolio_import'])
    expect(rpcArgs(db.queries[0]!)).toEqual({
      p_id: IMPORT,
      p_company_id: COMPANY,
      p_scope: 'properties',
      p_property_id: null,
      p_file_name: 'portfolio.csv',
      p_storage_path: PATH,
      p_file_format: 'csv',
      p_size_bytes: CSV.length,
      p_file_sha256: createHash('sha256').update(CSV).digest('hex'),
      p_sheet_name: null,
      p_sheet_names: [],
      p_delimiter: ';',
      p_columns: ['Property code', 'Property name'],
      p_rows: [
        { rowNumber: 2, cells: ['MSQ', 'Market Square'] },
        { rowNumber: 4, cells: ['KGP', 'Kgalagadi Park'] },
      ],
    })
    expect(batch).toEqual({
      id: IMPORT,
      companyId: COMPANY,
      scope: 'properties',
      fileName: 'portfolio.csv',
      fileFormat: 'csv',
      sizeBytes: CSV.length,
      sheetNames: [],
      delimiter: ';',
      columns: ['Property code', 'Property name'],
      rowCount: 2,
      uploadedByUserId: MANAGER,
      uploadedAt: '2026-11-20T08:00:00+00:00',
      createdAt: '2026-11-20T08:00:00+00:00',
      updatedAt: '2026-11-20T08:00:00+00:00',
    })
  })

  it('reads an XLSX workbook from its first sheet, or the sheet named', async () => {
    const workbook = xlsx([
      { name: 'Notes', rows: [['Read me'], ['Only the Units sheet matters']] },
      { name: 'Units', rows: [['Unit number', 'Floor area (m²)'], ['Shop 1', 145.5]] },
    ])
    const db = fakeDb((q) => (q.table === 'properties' ? { data: { status: 'active' }, error: null } : created(q)))
    await new PortfolioImportsService(fakeStorage(workbook)).create(db.client, COMPANY, {
      scope: 'units',
      propertyId: PROPERTY,
      storagePath: `${COMPANY}/${IMPORT}/units.xlsx`,
      fileName: 'units.xlsx',
      sizeBytes: workbook.length,
      sheetName: 'Units',
    })
    expect(rpcArgs(db.queries[1]!)).toMatchObject({
      p_scope: 'units',
      p_property_id: PROPERTY,
      p_file_format: 'xlsx',
      p_sheet_name: 'Units',
      p_sheet_names: ['Notes', 'Units'],
      p_delimiter: null,
      p_columns: ['Unit number', 'Floor area (m²)'],
      p_rows: [{ rowNumber: 2, cells: ['Shop 1', '145.5'] }],
    })
  })

  it('refuses an empty file, a file over 5 MB and a file over the row limit, writing nothing', async () => {
    const service = (file: Buffer) => new PortfolioImportsService(fakeStorage(file))
    const empty = Buffer.from('\ufeff\r\n', 'utf8')
    const db = fakeDb(created)
    await expect(service(empty).create(db.client, COMPANY, { ...body, sizeBytes: empty.length })).rejects.toThrow(
      new UnprocessableEntityException('The file is empty. Check that you chose the right file, or the right sheet.'),
    )
    await expect(service(CSV).create(db.client, COMPANY, { ...body, sizeBytes: 6 * 1024 * 1024 })).rejects.toThrow(PayloadTooLargeException)
    const many = Buffer.from(`Code\n${Array.from({ length: 5001 }, (_, i) => `P${i}`).join('\n')}\n`, 'utf8')
    await expect(service(many).create(db.client, COMPANY, { ...body, sizeBytes: many.length })).rejects.toThrow(/at most 5 000 rows/)
    expect(db.queries).toEqual([])
  })

  it('refuses a stored object over 5 MB even when the body claims less', async () => {
    const storage = fakeStorage()
    vi.mocked(storage.objectInfo).mockResolvedValueOnce({ sizeBytes: 6 * 1024 * 1024 })
    await expect(new PortfolioImportsService(storage).create(fakeDb(created).client, COMPANY, body)).rejects.toThrow(PayloadTooLargeException)
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('refuses a path of another company (400), a missing upload (422) and a property that cannot take units (422)', async () => {
    const db = fakeDb((q) => (q.table === 'properties' ? { data: { status: 'archived' }, error: null } : created(q)))
    await expect(new PortfolioImportsService(fakeStorage()).create(db.client, COMPANY, { ...body, storagePath: `${OTHER}/${IMPORT}/portfolio.csv` })).rejects.toThrow(
      BadRequestException,
    )
    const missing = fakeStorage()
    vi.mocked(missing.objectInfo).mockResolvedValueOnce(null)
    await expect(new PortfolioImportsService(missing).create(db.client, COMPANY, body)).rejects.toThrow(/Upload the file to storagePath/)
    await expect(new PortfolioImportsService(fakeStorage()).create(db.client, COMPANY, { ...body, scope: 'units', propertyId: PROPERTY })).rejects.toThrow(
      'This property is archived. Restore it before importing units into it.',
    )
  })
})

describe('PortfolioImportsService.selectSheet', () => {
  const workbook = xlsx([
    { name: 'Notes', rows: [['Read me'], ['x']] },
    { name: 'Units', rows: [['Unit number'], ['Shop 1'], ['Shop 2']] },
  ])
  const stored = batchRow({ file_format: 'xlsx', delimiter: null, sheet_name: 'Notes', sheet_names: ['Notes', 'Units'], size_bytes: workbook.length })

  it('reads the original workbook again from the chosen sheet and replaces the rows', async () => {
    const db = fakeDb((q) =>
      q.table === 'portfolio_imports' ? { data: stored, error: null } : { data: { ...stored, sheet_name: 'Units', columns: ['Unit number'], row_count: 2 }, error: null },
    )
    const batch = await new PortfolioImportsService(fakeStorage(workbook)).selectSheet(db.client, COMPANY, IMPORT, 'Units')
    expect(batch).toMatchObject({ sheetName: 'Units', rowCount: 2, columns: ['Unit number'] })
    expect(rpcArgs(db.queries[1]!)).toEqual({
      p_company_id: COMPANY,
      p_import_id: IMPORT,
      p_sheet_name: 'Units',
      p_columns: ['Unit number'],
      p_rows: [
        { rowNumber: 2, cells: ['Shop 1'] },
        { rowNumber: 3, cells: ['Shop 2'] },
      ],
    })
  })

  it('refuses a sheet the workbook does not have, and a CSV batch', async () => {
    const xlsxDb = fakeDb(() => ({ data: stored, error: null }))
    await expect(new PortfolioImportsService(fakeStorage(workbook)).selectSheet(xlsxDb.client, COMPANY, IMPORT, 'Leases')).rejects.toThrow(
      'The workbook has no sheet named "Leases"',
    )
    const csvDb = fakeDb(() => ({ data: batchRow(), error: null }))
    await expect(new PortfolioImportsService(fakeStorage()).selectSheet(csvDb.client, COMPANY, IMPORT, 'Sheet1')).rejects.toThrow('A CSV file has no sheets to choose from')
  })
})

describe('PortfolioImportsService.list', () => {
  it('lists the company’s import history newest first, narrowed to one property’s unit imports', async () => {
    const db = fakeDb(() => ({ data: [batchRow()], error: null, count: 1 }))
    const page = await new PortfolioImportsService(fakeStorage()).list(db.client, COMPANY, { page: 1, pageSize: 25, scope: 'units', propertyId: 'p-1' })
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25 })
    expect(page.items[0]).toMatchObject({ companyId: COMPANY, fileName: batchRow().file_name })
    const calls = db.queries[0]!.calls
    expect(calls).toContainEqual(['eq', ['company_id', COMPANY]])
    expect(calls).toContainEqual(['eq', ['scope', 'units']])
    expect(calls).toContainEqual(['eq', ['property_id', 'p-1']])
    expect(calls).toContainEqual(['order', ['uploaded_at', { ascending: false }]])
  })
})
