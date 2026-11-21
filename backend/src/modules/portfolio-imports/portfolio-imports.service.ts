import { createHash, randomUUID } from 'node:crypto'

import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  type HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  parseGoogleSheetsLink,
  PORTFOLIO_IMPORT_MAX_FILE_BYTES,
  PORTFOLIO_IMPORT_MIME_TYPES,
  type EntityId,
  type PortfolioImport,
  type PortfolioImportMimeType,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, toPage, type Page } from '../../common/http/pagination'
import type { Json } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { parseStorageObjectPath, storageObjectPath } from '../../infrastructure/storage/storage-paths'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { GoogleSheetError } from './google-sheets/fetch-google-sheet'
import { GoogleSheetsReader } from './google-sheets/google-sheets-reader'
import { toPortfolioImport } from './portfolio-imports.mapper'
import {
  PORTFOLIO_IMPORTS_BUCKET,
  type CreatePortfolioImportBody,
  type CreatePortfolioImportFromGoogleSheetBody,
  type CreatePortfolioImportUploadUrlBody,
  type PortfolioImportListQuery,
} from './portfolio-imports.schemas'
import { parsePortfolioFile, type ParsedPortfolioFile } from './spreadsheet/parse-portfolio-file'
import { PortfolioFileError } from './spreadsheet/portfolio-file-error'

/** Where and how the browser uploads a portfolio file before creating the batch. */
export interface PortfolioImportUploadUrl {
  importId: EntityId
  storagePath: string
  signedUrl: string
  token: string
  /** Send the file with this Content-Type: the bucket accepts only CSV and XLSX. */
  contentType: PortfolioImportMimeType
  maxSizeBytes: number
}

/** The SQL functions take NULL for "not applicable"; the generated argument types do not say so. */
const sqlNull = <T>(value: T | null): T => value as T

function contentTypeFor(fileName: string): PortfolioImportMimeType {
  return /\.xlsx$/i.test(fileName) ? PORTFOLIO_IMPORT_MIME_TYPES.xlsx : PORTFOLIO_IMPORT_MIME_TYPES.csv
}

function assertFileSize(sizeBytes: number): void {
  if (sizeBytes > PORTFOLIO_IMPORT_MAX_FILE_BYTES) {
    throw new PayloadTooLargeException(`The file is larger than the ${PORTFOLIO_IMPORT_MAX_FILE_BYTES / 1024 / 1024} MB limit for portfolio files`)
  }
}

const rowsJson = (parsed: ParsedPortfolioFile): Json => parsed.rows.map((row) => ({ rowNumber: row.rowNumber, cells: row.cells }))

/**
 * Portfolio import batches: (1) sign an upload into the private portfolio-imports bucket, (2) read the uploaded CSV or
 * XLSX file on the server and store it as a batch with its rows, (3) read a workbook's other sheet on request. Nothing
 * is written to properties or units here. Every step runs with the caller's RLS-bound client, so the database and
 * storage policies apply; the database stamps the uploader and records the audit entries.
 */
@Injectable()
export class PortfolioImportsService {
  constructor(
    private readonly storage: StorageService,
    private readonly sheets: GoogleSheetsReader = new GoogleSheetsReader(),
  ) {}

  async createUploadUrl(db: DbClient, companyId: EntityId, body: CreatePortfolioImportUploadUrlBody): Promise<PortfolioImportUploadUrl> {
    assertFileSize(body.sizeBytes)
    const importId = randomUUID()
    const signed = await this.storage.createSignedUploadUrl(db, PORTFOLIO_IMPORTS_BUCKET, storageObjectPath(companyId, importId, body.fileName))
    return {
      importId,
      storagePath: signed.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
      contentType: contentTypeFor(body.fileName),
      maxSizeBytes: PORTFOLIO_IMPORT_MAX_FILE_BYTES,
    }
  }

  /**
   * Reads the uploaded file and records it as a batch. Refused with 413 over the size limit, and with 422 when the
   * file is not there, the property cannot take units, or the file cannot be accepted (empty, headings only, over the
   * row or column limit, unreadable, or no such sheet), with a message saying what to do.
   */
  async create(db: DbClient, companyId: EntityId, body: CreatePortfolioImportBody): Promise<PortfolioImport> {
    assertFileSize(body.sizeBytes)
    const location = parseStorageObjectPath(body.storagePath)
    if (!location || location.companyId !== companyId) {
      throw new BadRequestException('storagePath must be a path returned by createPortfolioImportUploadUrl for the active company')
    }
    if (body.propertyId) await this.assertPropertyTakesUnits(db, companyId, body.propertyId)

    const bytes = await this.downloadOriginal(db, body.storagePath, body.sizeBytes)
    const parsed = readFile(bytes, body.sheetName)
    const row = unwrapDatabase(
      await db.rpc('create_portfolio_import', {
        p_id: location.entityId,
        p_company_id: companyId,
        p_scope: body.scope,
        p_property_id: sqlNull(body.propertyId ?? null),
        p_file_name: body.fileName,
        p_storage_path: body.storagePath,
        p_file_format: parsed.format,
        p_size_bytes: bytes.length,
        p_file_sha256: createHash('sha256').update(bytes).digest('hex'),
        p_sheet_name: sqlNull(parsed.sheetName),
        p_sheet_names: parsed.sheetNames,
        p_delimiter: sqlNull(parsed.delimiter),
        p_columns: parsed.columns,
        p_rows: rowsJson(parsed),
      }),
      'Create portfolio import',
      { '23505': () => new UnprocessableEntityException('This upload has already been recorded; upload the file again to start a new import') },
    )
    return toPortfolioImport(row)
  }

  /**
   * Reads a Google Sheet from its link and records it as a batch, as an uploaded CSV file would be: the API fetches the
   * sheet's CSV export (only from the docs.google.com address it builds from the link's spreadsheet and tab ids), keeps
   * what it read in the bucket as the batch's file, then stores the batch and its rows. Refused with 400 for a link
   * that is not a Google Sheets link, 422 for a sheet that is not shared with "Anyone with the link", does not exist or
   * cannot be accepted, 413 over the size limit, and 504 or 502 when Google is too slow or cannot be reached.
   */
  async createFromGoogleSheet(db: DbClient, companyId: EntityId, body: CreatePortfolioImportFromGoogleSheetBody): Promise<PortfolioImport> {
    const source = parseGoogleSheetsLink(body.url)
    if (!source) throw new BadRequestException('url must be a Google Sheets link (https://docs.google.com/spreadsheets/d/…)')
    if (body.propertyId) await this.assertPropertyTakesUnits(db, companyId, body.propertyId)

    const sheet = await this.sheets.read(source).catch((error: unknown) => {
      throw error instanceof GoogleSheetError ? httpErrorFromGoogleSheet(error) : error
    })
    assertFileSize(sheet.bytes.length)
    const parsed = readFile(sheet.bytes, undefined)
    if (parsed.format !== 'csv') throw new UnprocessableEntityException('Google Sheets did not send the sheet as CSV. Try again in a moment.')

    const importId = randomUUID()
    const storagePath = storageObjectPath(companyId, importId, sheet.fileName)
    await this.storage.upload(db, PORTFOLIO_IMPORTS_BUCKET, storagePath, sheet.bytes, PORTFOLIO_IMPORT_MIME_TYPES.csv)
    const row = unwrapDatabase(
      await db.rpc('create_portfolio_import', {
        p_id: importId,
        p_company_id: companyId,
        p_scope: body.scope,
        p_property_id: sqlNull(body.propertyId ?? null),
        p_file_name: sheet.fileName,
        p_storage_path: storagePath,
        p_file_format: 'csv',
        p_size_bytes: sheet.bytes.length,
        p_file_sha256: createHash('sha256').update(sheet.bytes).digest('hex'),
        p_sheet_name: sqlNull<string>(null),
        p_sheet_names: [],
        p_delimiter: sqlNull(parsed.delimiter),
        p_columns: parsed.columns,
        p_rows: rowsJson(parsed),
        p_google_spreadsheet_id: source.spreadsheetId,
        ...(source.gid !== undefined ? { p_google_sheet_gid: source.gid } : {}),
      }),
      'Create portfolio import from Google Sheet',
    )
    return toPortfolioImport(row)
  }

  /** The import history of the active company, newest first, so a batch left with rows to fix can be resumed. */
  async list(db: DbClient, companyId: EntityId, query: PortfolioImportListQuery): Promise<Page<PortfolioImport>> {
    const filtered = () => {
      let request = db.from('portfolio_imports').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.scope) request = request.eq('scope', query.scope)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      return request
    }
    const { data, error, count } = await filtered()
      .order('uploaded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List portfolio imports')
      throw httpErrorFromDatabase(error, 'List portfolio imports')
    }
    return toPage(data, count, query, toPortfolioImport)
  }

  async get(db: DbClient, companyId: EntityId, importId: EntityId): Promise<PortfolioImport> {
    const row = unwrapDatabase(
      await db.from('portfolio_imports').select('*').eq('company_id', companyId).eq('id', importId).maybeSingle(),
      'Get portfolio import',
    )
    return toPortfolioImport(row)
  }

  /** Reads the batch from another sheet of its workbook; its columns, row count and rows are replaced. */
  async selectSheet(db: DbClient, companyId: EntityId, importId: EntityId, sheetName: string): Promise<PortfolioImport> {
    const current = unwrapDatabase(
      await db.from('portfolio_imports').select('*').eq('company_id', companyId).eq('id', importId).maybeSingle(),
      'Get portfolio import',
    )
    if (current.file_format !== 'xlsx') throw new UnprocessableEntityException('A CSV file has no sheets to choose from')
    if (!current.sheet_names.includes(sheetName)) throw new UnprocessableEntityException(`The workbook has no sheet named "${sheetName}"`)
    if (current.sheet_name === sheetName) return toPortfolioImport(current)

    const parsed = readFile(await this.downloadOriginal(db, current.storage_path, current.size_bytes), sheetName)
    const row = unwrapDatabase(
      await db.rpc('replace_portfolio_import_sheet', {
        p_company_id: companyId,
        p_import_id: importId,
        p_sheet_name: sheetName,
        p_columns: parsed.columns,
        p_rows: rowsJson(parsed),
      }),
      'Select portfolio import sheet',
      { P0002: () => new NotFoundException('The record was not found') },
    )
    return toPortfolioImport(row)
  }

  /** Units go into a property of the active company that is not archived. */
  private async assertPropertyTakesUnits(db: DbClient, companyId: EntityId, propertyId: EntityId): Promise<void> {
    const { data, error } = await db.from('properties').select('status').eq('company_id', companyId).eq('id', propertyId).maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load import property')
    if (!data) throw new UnprocessableEntityException('propertyId does not name a property in this workspace')
    if (data.status === 'archived') throw new UnprocessableEntityException('This property is archived. Restore it before importing units into it.')
  }

  /** The uploaded file's bytes, read through the caller's client; refused when it is missing or its size differs. */
  private async downloadOriginal(db: DbClient, storagePath: string, sizeBytes: number): Promise<Buffer> {
    const object = await this.storage.objectInfo(db, PORTFOLIO_IMPORTS_BUCKET, storagePath)
    if (!object) throw new UnprocessableEntityException('Upload the file to storagePath before creating the import')
    if (object.sizeBytes !== undefined) {
      assertFileSize(object.sizeBytes)
      if (object.sizeBytes !== sizeBytes) throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    }
    const file = await this.storage.download(db, PORTFOLIO_IMPORTS_BUCKET, storagePath)
    if (!file) throw new UnprocessableEntityException('Upload the file to storagePath before creating the import')
    assertFileSize(file.size)
    if (file.size !== sizeBytes) throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    return Buffer.from(await file.arrayBuffer())
  }
}

/** A Google Sheet that could not be read, as the HTTP answer: the reader's message, which says what to do. */
function httpErrorFromGoogleSheet(error: GoogleSheetError): HttpException {
  switch (error.kind) {
    case 'not_shared':
    case 'not_found':
      return new UnprocessableEntityException(error.message)
    case 'too_large':
      return new PayloadTooLargeException(error.message)
    case 'timeout':
      return new GatewayTimeoutException(error.message)
    case 'unavailable':
      return new BadGatewayException(error.message)
  }
}

/** Parses the file; a file LeaseGuard cannot accept is a 422 with the reader's message. */
function readFile(bytes: Buffer, sheetName: string | undefined): ParsedPortfolioFile {
  try {
    return parsePortfolioFile(bytes, { sheetName })
  } catch (error) {
    if (error instanceof PortfolioFileError) throw new UnprocessableEntityException(error.message)
    throw error
  }
}
