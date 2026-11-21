import { PORTFOLIO_IMPORT_MAX_ROWS } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { detectDelimiter, parseCsv } from './csv'
import { parsePortfolioFile } from './parse-portfolio-file'
import { PortfolioFileError } from './portfolio-file-error'
import { isDateFormatCode, serialToIso } from './xlsx'
import { workbookParts, xlsx, zip } from './xlsx.test-helpers'

const utf8 = (text: string) => Buffer.from(text, 'utf8')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

function refusal(run: () => unknown): PortfolioFileError {
  try {
    run()
  } catch (error) {
    if (error instanceof PortfolioFileError) return error
    throw error
  }
  throw new Error('Expected the file to be refused')
}

describe('parsePortfolioFile: CSV', () => {
  it('reads a comma-separated file with a byte-order mark, ignoring empty rows', () => {
    const file = Buffer.concat([BOM, utf8('Property code,Property name,Unit number\r\nMSQ,Market Square,Shop 1\r\n,,\r\n\r\nMSQ,Market Square,Shop 2\r\n')])
    const parsed = parsePortfolioFile(file)
    expect(parsed).toMatchObject({ format: 'csv', delimiter: ',', sheetName: null, sheetNames: [], columns: ['Property code', 'Property name', 'Unit number'] })
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ['MSQ', 'Market Square', 'Shop 1'] },
      { rowNumber: 5, cells: ['MSQ', 'Market Square', 'Shop 2'] },
    ])
  })

  it('reads a semicolon-separated file without a byte-order mark, with quoted values and decimal commas', () => {
    const parsed = parsePortfolioFile(utf8('Unit number;Floor area (m²);Notes\n"Shop 1";145,5;"Corner; ""north"" side\nfacing the road"\n'))
    expect(parsed.delimiter).toBe(';')
    expect(parsed.columns).toEqual(['Unit number', 'Floor area (m²)', 'Notes'])
    expect(parsed.rows).toEqual([{ rowNumber: 2, cells: ['Shop 1', '145,5', 'Corner; "north" side\nfacing the road'] }])
  })

  it('names blank and repeated headings, pads short rows and drops trailing empty columns', () => {
    const parsed = parsePortfolioFile(utf8(' Code ,,Code,\nA,1\nB,2,x,\n'))
    expect(parsed.columns).toEqual(['Code', 'Column 2', 'Code (2)'])
    expect(parsed.rows.map((row) => row.cells)).toEqual([
      ['A', '1', ''],
      ['B', '2', 'x'],
    ])
  })

  it('refuses an empty file, a file of blank lines and a file with only headings', () => {
    expect(refusal(() => parsePortfolioFile(Buffer.alloc(0)))).toMatchObject({ kind: 'empty' })
    expect(refusal(() => parsePortfolioFile(Buffer.concat([BOM, utf8('\r\n , \r\n')])))).toMatchObject({ kind: 'empty' })
    expect(refusal(() => parsePortfolioFile(utf8('Property code,Property name\n\n')))).toMatchObject({
      kind: 'no_rows',
      message: 'The file has column headings but no rows below them.',
    })
  })

  it('refuses more rows than one import may hold, saying how many there are', () => {
    const rows = Array.from({ length: PORTFOLIO_IMPORT_MAX_ROWS + 1 }, (_, index) => `P${index},Name`).join('\n')
    expect(refusal(() => parsePortfolioFile(utf8(`Code,Name\n${rows}\n`)))).toMatchObject({
      kind: 'too_many_rows',
      message: 'The file has 5 001 rows; at most 5 000 rows can be imported at once. Split it into smaller files and upload them one by one.',
    })
    expect(parsePortfolioFile(utf8(`Code,Name\n${rows.split('\n').slice(1).join('\n')}\n`)).rows).toHaveLength(PORTFOLIO_IMPORT_MAX_ROWS)
  })

  it('refuses more than 100 columns', () => {
    const header = Array.from({ length: 101 }, (_, index) => `C${index}`).join(',')
    expect(refusal(() => parsePortfolioFile(utf8(`${header}\n${'x,'.repeat(100)}x\n`)))).toMatchObject({ kind: 'too_many_columns' })
  })

  it('refuses text that is not UTF-8, and an unclosed quote, instead of guessing', () => {
    expect(refusal(() => parsePortfolioFile(Buffer.from([0x43, 0x6f, 0x64, 0x65, 0x0a, 0xe9, 0x0a])))).toMatchObject({ kind: 'unreadable' })
    expect(refusal(() => parsePortfolioFile(Buffer.from([0xff, 0xfe, 0x43, 0x00])))).toMatchObject({ kind: 'unreadable' })
    expect(refusal(() => parsePortfolioFile(utf8('Code,Name\nA,"open\n')))).toMatchObject({
      message: 'A quoted value that starts on row 2 is never closed. Check the file and upload it again.',
    })
  })

  it('has no sheet to choose', () => {
    expect(refusal(() => parsePortfolioFile(utf8('A\n1\n'), { sheetName: 'Sheet1' }))).toMatchObject({ kind: 'sheet_not_found' })
  })
})

describe('CSV helpers', () => {
  it('detects the separator from the first non-empty line, outside quotes', () => {
    expect(detectDelimiter('a;b;c\n1,5;2;3')).toBe(';')
    expect(detectDelimiter('"a;b",c\n')).toBe(',')
    expect(detectDelimiter('\n\nname\n')).toBe(',')
  })

  it('numbers every record from 1, empty lines included', () => {
    expect(parseCsv('a\r\rb\nc').rows.map((row) => row.rowNumber)).toEqual([1, 2, 3, 4])
  })
})

describe('parsePortfolioFile: XLSX', () => {
  const sheets = [
    {
      name: 'Units',
      rows: [
        ['Unit number', 'Floor area (m²)', 'Let from', 'Anchor', 'Notes'],
        ['Shop 1', 145.5, { date: 46023 }, true, { inline: 'Corner & north' }],
        [null, null, null, null, null],
        ['Shop 2', 0.1 + 0.2, null, false, null],
      ],
    },
    { name: 'Properties', rows: [['Property code'], ['MSQ']] },
  ]

  it('reads the first sheet by default, with numbers, dates, booleans and inline text as a person would type them', () => {
    const parsed = parsePortfolioFile(xlsx(sheets))
    expect(parsed).toMatchObject({ format: 'xlsx', delimiter: null, sheetName: 'Units', sheetNames: ['Units', 'Properties'] })
    expect(parsed.columns).toEqual(['Unit number', 'Floor area (m²)', 'Let from', 'Anchor', 'Notes'])
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ['Shop 1', '145.5', '2026-01-01', 'TRUE', 'Corner & north'] },
      { rowNumber: 4, cells: ['Shop 2', '0.3', '', 'FALSE', ''] },
    ])
  })

  it('reads the sheet chosen, and refuses a sheet the workbook does not have', () => {
    expect(parsePortfolioFile(xlsx(sheets), { sheetName: 'Properties' })).toMatchObject({ sheetName: 'Properties', columns: ['Property code'], rows: [{ rowNumber: 2, cells: ['MSQ'] }] })
    expect(refusal(() => parsePortfolioFile(xlsx(sheets), { sheetName: 'Leases' }))).toMatchObject({ kind: 'sheet_not_found', message: 'The workbook has no sheet named "Leases".' })
  })

  it('skips hidden sheets by default and reads stored (uncompressed) archives', () => {
    const parsed = parsePortfolioFile(xlsx([{ name: 'Lookup', hidden: true, rows: [['x'], ['y']] }, ...sheets], { store: true }))
    expect(parsed.sheetName).toBe('Units')
    expect(parsed.sheetNames).toEqual(['Lookup', 'Units', 'Properties'])
  })

  it('reads workbooks whose parts use namespace prefixes', () => {
    const parts = workbookParts([{ name: 'Sheet1', rows: [['Code'], ['MSQ']] }])
    parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml']!.replace(/<(\/?)(worksheet|sheetData|row|c|v)\b/g, '<$1x:$2')
    expect(parsePortfolioFile(zip(parts)).rows).toEqual([{ rowNumber: 2, cells: ['MSQ'] }])
  })

  it('refuses an empty sheet and a sheet with only headings', () => {
    expect(refusal(() => parsePortfolioFile(xlsx([{ name: 'Sheet1', rows: [] }])))).toMatchObject({ kind: 'empty' })
    expect(refusal(() => parsePortfolioFile(xlsx([{ name: 'Sheet1', rows: [['Code', 'Name']] }])))).toMatchObject({ kind: 'no_rows' })
  })

  it('refuses old .xls and password-protected workbooks, and damaged archives', () => {
    const cfb = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(refusal(() => parsePortfolioFile(cfb)).message).toMatch(/older Excel workbook \(\.xls\) or a password-protected one/)
    expect(refusal(() => parsePortfolioFile(xlsx(sheets).subarray(0, 200)))).toMatchObject({ kind: 'unreadable' })
    expect(refusal(() => parsePortfolioFile(zip({ 'hello.txt': 'not a workbook' })))).toMatchObject({ kind: 'unreadable' })
  })
})

describe('XLSX helpers', () => {
  it('converts Excel date serials, including the 1904 system and times of day', () => {
    expect(serialToIso(1, false)).toBe('1900-01-01')
    expect(serialToIso(61, false)).toBe('1900-03-01')
    expect(serialToIso(46023, false)).toBe('2026-01-01')
    expect(serialToIso(46023.5, false)).toBe('2026-01-01 12:00')
    expect(serialToIso(0, true)).toBe('1904-01-01')
  })

  it('tells date formats from number formats', () => {
    expect(isDateFormatCode('yyyy/mm/dd')).toBe(true)
    expect(isDateFormatCode('[$-1C09]dd mmmm yyyy')).toBe(true)
    expect(isDateFormatCode('[h]:mm')).toBe(true)
    expect(isDateFormatCode('#,##0.00')).toBe(false)
    expect(isDateFormatCode('"R" #,##0.00')).toBe(false)
    expect(isDateFormatCode('[Red]0.00')).toBe(false)
    expect(isDateFormatCode('General')).toBe(false)
  })
})
