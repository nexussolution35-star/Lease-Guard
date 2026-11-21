import type { CompanyScoped, EntityId, ISODateTime } from './common.js'

/**
 * What a portfolio import adds: properties together with their units (started from the Properties screen), or units
 * of one existing property (started from that property's screen).
 */
export const PORTFOLIO_IMPORT_SCOPES = ['properties', 'units'] as const
export type PortfolioImportScope = (typeof PORTFOLIO_IMPORT_SCOPES)[number]

/** File formats a portfolio import accepts. */
export const PORTFOLIO_IMPORT_FILE_FORMATS = ['csv', 'xlsx'] as const
export type PortfolioImportFileFormat = (typeof PORTFOLIO_IMPORT_FILE_FORMATS)[number]

/** Media type stored for each format (the upload's Content-Type, checked by the storage bucket). */
export const PORTFOLIO_IMPORT_MIME_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const satisfies Record<PortfolioImportFileFormat, string>
export type PortfolioImportMimeType = (typeof PORTFOLIO_IMPORT_MIME_TYPES)[PortfolioImportFileFormat]

/** CSV field separators a portfolio file may use. */
export const PORTFOLIO_IMPORT_DELIMITERS = [',', ';'] as const
export type PortfolioImportDelimiter = (typeof PORTFOLIO_IMPORT_DELIMITERS)[number]

/**
 * A Google Sheet a portfolio import reads: the spreadsheet and, when the link names one, the tab (Google's `gid`);
 * without a tab, the first one.
 */
export interface GoogleSheetSource {
  spreadsheetId: string
  gid?: string
}

/** Largest portfolio file accepted: 5 MiB (the storage bucket enforces the same limit). */
export const PORTFOLIO_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024

/** Most data rows (after empty rows are ignored) one import may hold. */
export const PORTFOLIO_IMPORT_MAX_ROWS = 5000

/** Most columns one import may hold. */
export const PORTFOLIO_IMPORT_MAX_COLUMNS = 100

/**
 * An uploaded portfolio file accepted as an import batch: the original file is kept in storage, and its rows are
 * parsed and stored against the batch. Nothing is written to properties or units by uploading.
 */
export interface PortfolioImport extends CompanyScoped {
  scope: PortfolioImportScope
  /** The property the units are for; present exactly when `scope` is `units`. */
  propertyId?: EntityId
  fileName: string
  fileFormat: PortfolioImportFileFormat
  sizeBytes: number
  /** The worksheet the rows were read from (XLSX only). */
  sheetName?: string
  /** Every worksheet in the workbook, in workbook order (empty for CSV). */
  sheetNames: readonly string[]
  /** The field separator detected (CSV only). */
  delimiter?: PortfolioImportDelimiter
  /**
   * The Google Sheet the rows were read from, when the batch was made from a link rather than an uploaded file; the
   * CSV LeaseGuard read is kept as the batch's file, so the batch does not change when the sheet does.
   */
  googleSheet?: GoogleSheetSource
  /** Column headings from the file's first non-empty row, in file order. */
  columns: readonly string[]
  /** Data rows stored, empty rows not counted. */
  rowCount: number
  /** Absent when the member who uploaded the file has since left the company. */
  uploadedByUserId?: EntityId
  uploadedAt: ISODateTime
}
