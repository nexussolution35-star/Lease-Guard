import { createHash } from 'node:crypto'

import { BadGatewayException, BadRequestException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { fakeDb, rpcArgs, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { StorageService } from '../../infrastructure/storage/storage.service'
import { GoogleSheetError, NOT_SHARED_MESSAGE, type FetchedGoogleSheet } from './google-sheets/fetch-google-sheet'
import type { GoogleSheetsReader } from './google-sheets/google-sheets-reader'
import { PORTFOLIO_IMPORTS_BUCKET } from './portfolio-imports.schemas'
import { PortfolioImportsService } from './portfolio-imports.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000e1'
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`
const CSV = Buffer.from('Property code,Property name\r\nMSQ,Market Square\r\nKGP,Kgalagadi Park\r\n', 'utf8')

const batchRow = (q: RecordedQuery) => {
  const args = rpcArgs(q) as Record<string, unknown>
  return {
    id: args.p_id,
    company_id: COMPANY,
    scope: args.p_scope,
    property_id: args.p_property_id,
    file_name: args.p_file_name,
    storage_path: args.p_storage_path,
    file_format: 'csv',
    size_bytes: args.p_size_bytes,
    file_sha256: args.p_file_sha256,
    sheet_name: null,
    sheet_names: [],
    delimiter: args.p_delimiter,
    columns: args.p_columns,
    row_count: 2,
    google_spreadsheet_id: args.p_google_spreadsheet_id,
    google_sheet_gid: args.p_google_sheet_gid ?? null,
    uploaded_by_user_id: null,
    uploaded_at: '2026-11-20T08:00:00+00:00',
    created_at: '2026-11-20T08:00:00+00:00',
    updated_at: '2026-11-20T08:00:00+00:00',
  }
}
const created = (q: RecordedQuery) =>
  q.table === 'rpc:create_portfolio_import'
    ? { data: batchRow(q), error: null }
    : q.table === 'properties'
      ? { data: { status: 'active' }, error: null }
      : { data: null, error: null }

function fakeStorage() {
  return { upload: vi.fn(async () => undefined), removeObject: vi.fn(async () => undefined) } as unknown as StorageService & Record<string, ReturnType<typeof vi.fn>>
}

function reader(answer: FetchedGoogleSheet | GoogleSheetError = { bytes: CSV, fileName: 'Rent roll - Units.csv' }) {
  return {
    read: vi.fn(async () => {
      if (answer instanceof Error) throw answer
      return answer
    }),
  } as unknown as GoogleSheetsReader & { read: ReturnType<typeof vi.fn> }
}

describe('PortfolioImportsService.createFromGoogleSheet', () => {
  it('reads the first tab of a valid link, keeps the CSV snapshot in the bucket and records the batch from it', async () => {
    const db = fakeDb(created)
    const storage = fakeStorage()
    const sheets = reader()
    const batch = await new PortfolioImportsService(storage, sheets).createFromGoogleSheet(db.client, COMPANY, { scope: 'properties', url: LINK })

    expect(sheets.read).toHaveBeenCalledWith({ spreadsheetId: SHEET_ID })
    const args = rpcArgs(db.queries[0]!) as Record<string, unknown>
    expect(storage.upload).toHaveBeenCalledWith(expect.anything(), PORTFOLIO_IMPORTS_BUCKET, args.p_storage_path, CSV, 'text/csv')
    expect(args.p_storage_path).toBe(`${COMPANY}/${args.p_id as string}/Rent-roll-Units.csv`)
    expect(args).toMatchObject({
      p_company_id: COMPANY,
      p_scope: 'properties',
      p_property_id: null,
      p_file_name: 'Rent roll - Units.csv',
      p_file_format: 'csv',
      p_size_bytes: CSV.length,
      p_file_sha256: createHash('sha256').update(CSV).digest('hex'),
      p_sheet_name: null,
      p_sheet_names: [],
      p_delimiter: ',',
      p_columns: ['Property code', 'Property name'],
      p_rows: [
        { rowNumber: 2, cells: ['MSQ', 'Market Square'] },
        { rowNumber: 3, cells: ['KGP', 'Kgalagadi Park'] },
      ],
      p_google_spreadsheet_id: SHEET_ID,
    })
    expect(args).not.toHaveProperty('p_google_sheet_gid')
    expect(batch).toMatchObject({ fileName: 'Rent roll - Units.csv', fileFormat: 'csv', rowCount: 2, googleSheet: { spreadsheetId: SHEET_ID } })
  })

  it('reads the tab in a link with a tab id, into a property', async () => {
    const db = fakeDb(created)
    const sheets = reader()
    const batch = await new PortfolioImportsService(fakeStorage(), sheets).createFromGoogleSheet(db.client, COMPANY, {
      scope: 'units',
      propertyId: PROPERTY,
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=1386834576`,
    })
    expect(sheets.read).toHaveBeenCalledWith({ spreadsheetId: SHEET_ID, gid: '1386834576' })
    expect(rpcArgs(db.queries[1]!)).toMatchObject({ p_scope: 'units', p_property_id: PROPERTY, p_google_sheet_gid: '1386834576' })
    expect(batch.googleSheet).toEqual({ spreadsheetId: SHEET_ID, gid: '1386834576' })
  })

  it('refuses a link that is not a Google Sheets link without fetching anything', async () => {
    const sheets = reader()
    const db = fakeDb(created)
    await expect(
      new PortfolioImportsService(fakeStorage(), sheets).createFromGoogleSheet(db.client, COMPANY, { scope: 'properties', url: 'https://example.com/rent-roll.csv' }),
    ).rejects.toThrow(BadRequestException)
    expect(sheets.read).not.toHaveBeenCalled()
    expect(db.queries).toEqual([])
  })

  it('says how to share a private sheet, and refuses an oversized one, storing nothing', async () => {
    const storage = fakeStorage()
    const db = fakeDb(created)
    const run = (sheets: GoogleSheetsReader) => new PortfolioImportsService(storage, sheets).createFromGoogleSheet(db.client, COMPANY, { scope: 'properties', url: LINK })

    await expect(run(reader(new GoogleSheetError('not_shared', NOT_SHARED_MESSAGE)))).rejects.toThrow(new UnprocessableEntityException(NOT_SHARED_MESSAGE))
    await expect(run(reader(new GoogleSheetError('too_large', 'too large')))).rejects.toThrow(PayloadTooLargeException)
    await expect(run(reader({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 0x41), fileName: 'big.csv' }))).rejects.toThrow(PayloadTooLargeException)
    await expect(run(reader(new GoogleSheetError('unavailable', 'down')))).rejects.toThrow(BadGatewayException)
    await expect(run(reader({ bytes: Buffer.from('Code\n', 'utf8'), fileName: 'x.csv' }))).rejects.toThrow('The file has column headings but no rows below them.')
    expect(storage.upload).not.toHaveBeenCalled()
    expect(db.queries).toEqual([])
  })
  it('removes the stored snapshot when the batch is refused, and still reports the refusal', async () => {
    const db = fakeDb((q) => (q.table === 'rpc:create_portfolio_import' ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } } : created(q)))
    const storage = fakeStorage()
    storage.removeObject.mockRejectedValueOnce(new Error('storage is down'))
    const service = new PortfolioImportsService(storage, reader())

    await expect(service.createFromGoogleSheet(db.client, COMPANY, { scope: 'properties', url: LINK })).rejects.toThrow()
    const args = rpcArgs(db.queries.find((q) => q.table === 'rpc:create_portfolio_import')!) as Record<string, unknown>
    expect(storage.upload).toHaveBeenCalledOnce()
    expect(storage.removeObject).toHaveBeenCalledWith(expect.anything(), PORTFOLIO_IMPORTS_BUCKET, args.p_storage_path)
  })
})
