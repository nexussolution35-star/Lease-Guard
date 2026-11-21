import { PORTFOLIO_IMPORT_MAX_COLUMNS, PORTFOLIO_IMPORT_MAX_ROWS } from '@leaseguard/domain'

import { PortfolioFileError } from './portfolio-file-error'

/** One row as read from the file: its number there (1 is the first row) and its cells in column order. */
export interface SourceRow {
  rowNumber: number
  cells: string[]
}

/** A file's rows as an import stores them: headings, then data rows padded to the same width. */
export interface PortfolioTable {
  columns: string[]
  rows: SourceRow[]
}

const COUNT_FORMAT = new Intl.NumberFormat('en-ZA')
/** `5 001`, with an ordinary space (en-ZA groups digits with a no-break space, which reads oddly in API messages). */
const count = (value: number) => COUNT_FORMAT.format(value).replace(/\s/g, ' ')

export const tooManyRows = (rows: number) =>
  new PortfolioFileError(
    'too_many_rows',
    `The file has ${count(rows)} rows; at most ${count(PORTFOLIO_IMPORT_MAX_ROWS)} rows can be imported at once. Split it into smaller files and upload them one by one.`,
  )

export const tooManyColumns = () =>
  new PortfolioFileError(
    'too_many_columns',
    `The file has more than ${PORTFOLIO_IMPORT_MAX_COLUMNS} columns. Remove the columns LeaseGuard does not need and upload it again.`,
  )

const isEmpty = (cells: readonly string[]) => cells.every((cell) => cell === '')

/**
 * Turns the rows read from a file into an import table. Cells are trimmed and rows whose cells are all empty are
 * ignored. The first remaining row holds the column headings: a blank heading becomes "Column N" (its position) and a
 * repeated one gets a "(2)", "(3)" suffix, so every column can be told apart. Trailing columns with neither a heading
 * nor a value are dropped. Refused when nothing is left, when only headings are left, or over the row or column limit.
 */
export function toPortfolioTable(source: readonly SourceRow[]): PortfolioTable {
  let header: SourceRow | undefined
  const rows: SourceRow[] = []
  for (const row of source) {
    const cells = row.cells.map((cell) => cell.trim())
    if (isEmpty(cells)) continue
    if (!header) {
      header = { rowNumber: row.rowNumber, cells }
      continue
    }
    rows.push({ rowNumber: row.rowNumber, cells })
  }
  if (!header) throw new PortfolioFileError('empty', 'The file is empty. Check that you chose the right file, or the right sheet.')
  if (rows.length === 0) throw new PortfolioFileError('no_rows', 'The file has column headings but no rows below them.')
  if (rows.length > PORTFOLIO_IMPORT_MAX_ROWS) throw tooManyRows(rows.length)

  let width = Math.max(header.cells.length, ...rows.map((row) => row.cells.length))
  while (width > 0 && !header.cells[width - 1] && rows.every((row) => !row.cells[width - 1])) width--
  if (width > PORTFOLIO_IMPORT_MAX_COLUMNS) throw tooManyColumns()

  return {
    columns: columnNames(header.cells, width),
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, cells: Array.from({ length: width }, (_, index) => row.cells[index] ?? '') })),
  }
}

function columnNames(headings: readonly string[], width: number): string[] {
  const used = new Map<string, number>()
  return Array.from({ length: width }, (_, index) => {
    const base = headings[index] || `Column ${index + 1}`
    const key = base.toLowerCase()
    const seen = (used.get(key) ?? 0) + 1
    used.set(key, seen)
    return seen === 1 ? base : `${base} (${seen})`
  })
}
