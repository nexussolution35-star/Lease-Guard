import type { PortfolioImportDelimiter } from '@leaseguard/domain'

import { PortfolioFileError } from './portfolio-file-error'
import type { SourceRow } from './table'

export interface CsvContent {
  delimiter: PortfolioImportDelimiter
  rows: SourceRow[]
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const

const notUtf8 = () =>
  new PortfolioFileError('unreadable', 'The file is not UTF-8 text. Save it as "CSV UTF-8 (comma delimited)" and upload it again.')

/** UTF-8 text of a CSV file, with or without a byte-order mark. Other encodings are refused, never guessed. */
export function decodeCsv(bytes: Uint8Array): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) throw notUtf8()
  const start = UTF8_BOM.every((byte, index) => bytes[index] === byte) ? UTF8_BOM.length : 0
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start))
  } catch {
    throw notUtf8()
  }
}

/**
 * The field separator: a semicolon when the first non-empty line has more semicolons than commas outside quotes (as
 * spreadsheet programs write CSV in locales with a decimal comma, South Africa's included), otherwise a comma.
 */
export function detectDelimiter(text: string): PortfolioImportDelimiter {
  let commas = 0
  let semicolons = 0
  let quoted = false
  let seenContent = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (seenContent) break
    } else if (!quoted && char === ',') commas++
    else if (!quoted && char === ';') semicolons++
    if (char.trim() !== '') seenContent = true
  }
  return semicolons > commas ? ';' : ','
}

/**
 * Parses CSV text (RFC 4180: double-quoted fields, `""` for a quote inside one, CRLF, LF or CR line ends). Row
 * numbers count every record from 1, empty lines included, so they match the row numbers a spreadsheet program shows
 * for the same file. A quote left open at the end of the file is refused rather than guessed.
 */
export function parseCsv(text: string, delimiter: PortfolioImportDelimiter = detectDelimiter(text)): CsvContent {
  const rows: SourceRow[] = []
  let cells: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  let rowNumber = 1
  let quoteOpenedAt = 0

  const endField = () => {
    cells.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    rows.push({ rowNumber, cells })
    cells = []
    rowNumber++
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      quoteOpenedAt = rowNumber
    } else if (char === delimiter) {
      endField()
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++
      endRow()
    } else {
      field += char
      fieldStarted = true
    }
  }
  if (quoted) {
    throw new PortfolioFileError('unreadable', `A quoted value that starts on row ${quoteOpenedAt} is never closed. Check the file and upload it again.`)
  }
  // The last record, unless the file ends with a line break.
  if (field !== '' || fieldStarted || cells.length > 0) endRow()
  return { delimiter, rows }
}
