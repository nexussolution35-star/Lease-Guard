/**
 * CSV export of a report table (RFC 4180): exactly the rows on screen, one line per row. Amounts are plain numbers in
 * rand with two decimals and dates stay ISO (`YYYY-MM-DD`), so a spreadsheet reads them as numbers and dates whatever
 * its locale; the headers say the unit.
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

/** Text a spreadsheet would run as a formula (CSV injection): prefixed with an apostrophe so it stays text. */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) || text.trim() !== text ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => cell(column.header)), ...rows.map((row) => columns.map((column) => cell(column.value(row))))]
  return `${lines.map((line) => line.join(',')).join('\r\n')}\r\n`
}

/** An amount in rand as CSV text: two decimals, no currency symbol or grouping. */
export const csvAmount = (amount: number): string => amount.toFixed(2)

/** A 0–1 rate as a percentage with one decimal. */
export const csvPercent = (rate: number): string => (rate * 100).toFixed(1)

/** `leaseguard-occupancy-2026-11-21.csv` */
export function reportFileName(reportId: string, asOf: string): string {
  return `leaseguard-${reportId.replaceAll('_', '-')}-${asOf}.csv`
}

/**
 * Saves `csv` as a file. A UTF-8 byte order mark lets spreadsheet software read accented names (e.g. Ntombi Ngcobo-
 * Müller) correctly; the object URL is released once the download has started.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
