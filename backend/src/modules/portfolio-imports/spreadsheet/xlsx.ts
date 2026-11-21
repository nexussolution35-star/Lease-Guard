import { PORTFOLIO_IMPORT_MAX_COLUMNS } from '@leaseguard/domain'

import { PortfolioFileError } from './portfolio-file-error'
import { tooManyColumns, type SourceRow } from './table'
import { openZip, type ZipArchive } from './zip'

/**
 * Reads worksheets of an XLSX workbook (Office Open XML). The parts are machine-written XML, read with patterns for
 * the few elements a table needs: the workbook's sheet list, shared strings, number formats (to tell dates from
 * numbers) and one worksheet's cells. Values come back as the text a person would type: shared and inline strings as
 * written, numbers without floating-point noise, dates as ISO dates, booleans as TRUE or FALSE. Formulas are read as
 * their last calculated value.
 */

/** Largest uncompressed workbook part read. */
const MAX_PART_BYTES = 64 * 1024 * 1024

export interface Workbook {
  /** Every worksheet, in workbook order. */
  sheetNames: string[]
  /** The sheet read when none is chosen: the first visible one. */
  defaultSheet: string
  /** The rows of one worksheet, in sheet order; empty rows and cells are absent. */
  readSheet(name: string): SourceRow[]
}

interface SheetEntry {
  name: string
  path: string
  hidden: boolean
}

const unreadable = (detail: string) =>
  new PortfolioFileError('unreadable', `The workbook could not be read (${detail}). Save it again as .xlsx, or as CSV, and upload it again.`)

export function openWorkbook(bytes: Buffer): Workbook {
  const zip = openZip(bytes, MAX_PART_BYTES)
  const workbookXml = readPart(zip, 'xl/workbook.xml')
  if (workbookXml === null) throw unreadable('it has no workbook part')
  const sheets = sheetEntries(workbookXml, readPart(zip, 'xl/_rels/workbook.xml.rels') ?? '')
  if (sheets.length === 0) throw unreadable('it has no worksheets')

  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml)
  let sharedStrings: string[] | undefined
  let dateStyles: Set<number> | undefined

  return {
    sheetNames: sheets.map((sheet) => sheet.name),
    defaultSheet: (sheets.find((sheet) => !sheet.hidden) ?? sheets[0]!).name,
    readSheet(name) {
      const sheet = sheets.find((entry) => entry.name === name)
      if (!sheet) throw new PortfolioFileError('sheet_not_found', `The workbook has no sheet named "${name}".`)
      const xml = readPart(zip, sheet.path)
      if (xml === null) throw unreadable(`the sheet ${name} is missing`)
      sharedStrings ??= parseSharedStrings(readPart(zip, 'xl/sharedStrings.xml') ?? '')
      dateStyles ??= parseDateStyles(readPart(zip, 'xl/styles.xml') ?? '')
      return parseSheet(xml, { sharedStrings, dateStyles, date1904 })
    },
  }
}

function readPart(zip: ZipArchive, name: string): string | null {
  const bytes = zip.read(name)
  // Some writers use namespace prefixes (<x:row>); the patterns below read unprefixed element names.
  return bytes === null ? null : bytes.toString('utf8').replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1')
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? undefined : decodeXml(value)
}

function sheetEntries(workbookXml: string, relsXml: string): SheetEntry[] {
  const targets = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1]!, 'Id')
    const target = attribute(match[1]!, 'Target')
    if (id && target) targets.set(id, target)
  }
  const sheets: SheetEntry[] = []
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attributes = match[1]!
    const name = attribute(attributes, 'name')
    const target = targets.get(attribute(attributes, 'r:id') ?? attribute(attributes, 'id') ?? '')
    if (!name || !target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    sheets.push({ name, path, hidden: (attribute(attributes, 'state') ?? 'visible') !== 'visible' })
  }
  return sheets
}

/** Text of a string item (`<si>` or `<is>`): its `<t>` runs, without phonetic guides. */
function itemText(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let text = ''
  for (const match of withoutPhonetics.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeXml(match[1] ?? '')
  return text
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => itemText(match[1] ?? ''))
}

/** Built-in number formats that show a date or time. */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

/** True when a custom format code shows a date or time (letters outside quotes, escapes and [colour] sections). */
export function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '')
  return /[ymdhs]/i.test(bare) && !/^general$/i.test(bare.trim())
}

/** Indexes of the cell styles (`cellXfs`) whose number format shows a date. */
function parseDateStyles(xml: string): Set<number> {
  const customDates = new Set<number>()
  for (const match of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = Number(attribute(match[1]!, 'numFmtId'))
    if (isDateFormatCode(attribute(match[1]!, 'formatCode') ?? '')) customDates.add(id)
  }
  const styles = new Set<number>()
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  let index = 0
  for (const match of cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const formatId = Number(attribute(match[1]!, 'numFmtId') ?? 0)
    if (BUILT_IN_DATE_FORMATS.has(formatId) || customDates.has(formatId)) styles.add(index)
    index++
  }
  return styles
}

interface SheetContext {
  sharedStrings: readonly string[]
  dateStyles: ReadonlySet<number>
  date1904: boolean
}

/** Zero-based column index of a cell reference such as `AB12`; `undefined` when there is none. */
function columnIndex(reference: string | undefined): number | undefined {
  const letters = reference ? /^([A-Z]+)/i.exec(reference)?.[1] : undefined
  if (!letters) return undefined
  let index = 0
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

function parseSheet(xml: string, context: SheetContext): SourceRow[] {
  const data = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml)?.[1] ?? ''
  const rows: SourceRow[] = []
  let nextRowNumber = 1
  for (const rowMatch of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attribute(rowMatch[1]!, 'r')) || nextRowNumber
    nextRowNumber = rowNumber + 1
    const cells: string[] = []
    let nextColumn = 0
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = columnIndex(attribute(cellMatch[1]!, 'r')) ?? nextColumn
      nextColumn = column + 1
      const value = cellValue(cellMatch[1]!, cellMatch[2] ?? '', context)
      if (value === '') continue
      if (column >= PORTFOLIO_IMPORT_MAX_COLUMNS) throw tooManyColumns()
      while (cells.length < column) cells.push('')
      cells[column] = value
    }
    if (cells.length > 0) rows.push({ rowNumber, cells })
  }
  return rows
}

function cellValue(attributes: string, content: string, context: SheetContext): string {
  const type = attribute(attributes, 't') ?? 'n'
  if (type === 'inlineStr') return itemText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(content)?.[1] ?? '')
  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1]
  if (raw === undefined) return ''
  const value = decodeXml(raw)
  switch (type) {
    case 's':
      return context.sharedStrings[Number(value)] ?? ''
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE'
    case 'str':
    case 'e':
    case 'd':
      return value
    default: {
      const number = Number(value)
      if (value.trim() === '' || !Number.isFinite(number)) return value
      const style = Number(attribute(attributes, 's') ?? 0)
      if (context.dateStyles.has(style)) return serialToIso(number, context.date1904)
      // Excel shows at most 15 significant digits; the stored binary value often has noise beyond them.
      return String(Number.parseFloat(number.toPrecision(15)))
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Day 0 of the 1900 date system as Excel counts it (it treats 1900 as a leap year, so day 60 does not exist). */
const EPOCH_1900 = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)

/** An Excel date serial as `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` when it has a time of day. */
export function serialToIso(serial: number, date1904: boolean): string {
  const days = date1904 ? serial : serial < 61 ? serial + 1 : serial
  const ms = (date1904 ? EPOCH_1904 : EPOCH_1900) + Math.round(days * DAY_MS / 60_000) * 60_000
  const iso = new Date(ms).toISOString()
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity
      }
      return NAMED_ENTITIES[name] ?? entity
    })
    // Excel escapes control characters in strings as _xHHHH_.
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}
