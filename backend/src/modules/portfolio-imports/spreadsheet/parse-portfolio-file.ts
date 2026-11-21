import type { PortfolioImportDelimiter, PortfolioImportFileFormat } from '@leaseguard/domain'

import { decodeCsv, parseCsv } from './csv'
import { PortfolioFileError } from './portfolio-file-error'
import { toPortfolioTable, type PortfolioTable } from './table'
import { openWorkbook } from './xlsx'

export interface ParsedPortfolioFile extends PortfolioTable {
  format: PortfolioImportFileFormat
  /** CSV only. */
  delimiter: PortfolioImportDelimiter | null
  /** XLSX only: the worksheet read. */
  sheetName: string | null
  /** XLSX only: every worksheet, in workbook order. */
  sheetNames: string[]
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const
/** Compound File Binary: Excel 97–2003 (.xls) workbooks, and password-protected .xlsx files. */
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte)

/**
 * The format of a portfolio file from its content, not its name: an XLSX workbook is a ZIP archive; anything else is
 * read as CSV text. Older .xls workbooks and password-protected ones are refused with what to do instead.
 */
export function detectPortfolioFileFormat(bytes: Uint8Array): PortfolioImportFileFormat {
  if (startsWith(bytes, ZIP_SIGNATURE)) return 'xlsx'
  if (startsWith(bytes, CFB_SIGNATURE)) {
    throw new PortfolioFileError(
      'unreadable',
      'This is an older Excel workbook (.xls) or a password-protected one. Save it as .xlsx without a password, or as CSV, and upload it again.',
    )
  }
  return 'csv'
}

/**
 * Reads a portfolio file into an import table: CSV (comma or semicolon separated, UTF-8 with or without a byte-order
 * mark) or XLSX (the first visible sheet unless `sheetName` names another). Throws `PortfolioFileError` with a message
 * for the person who uploaded it when the file cannot be accepted.
 */
export function parsePortfolioFile(bytes: Buffer, options: { sheetName?: string | undefined } = {}): ParsedPortfolioFile {
  const format = detectPortfolioFileFormat(bytes)
  if (format === 'xlsx') {
    const workbook = openWorkbook(bytes)
    const sheetName = options.sheetName ?? workbook.defaultSheet
    return { format, delimiter: null, sheetName, sheetNames: workbook.sheetNames, ...toPortfolioTable(workbook.readSheet(sheetName)) }
  }
  if (options.sheetName !== undefined) throw new PortfolioFileError('sheet_not_found', 'A CSV file has no sheets to choose from.')
  const csv = parseCsv(decodeCsv(bytes))
  return { format, delimiter: csv.delimiter, sheetName: null, sheetNames: [], ...toPortfolioTable(csv.rows) }
}
