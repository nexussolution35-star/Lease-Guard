import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Builds small XLSX workbooks for tests: real ZIP archives of the parts a spreadsheet program writes (workbook,
 * relationships, shared strings, styles with a date format, one part per sheet).
 */

/** A cell: text (shared string), a number, `{ date }` (an Excel serial shown as a date), `{ inline }`, or empty. */
export type TestCell = string | number | boolean | { date: number } | { inline: string } | null

export interface TestSheet {
  name: string
  rows: TestCell[][]
  hidden?: boolean
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function columnLetters(index: number): string {
  let letters = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  return letters
}

/** A ZIP archive of `parts`, deflated unless `store` is set. */
export function zip(parts: Record<string, string | Buffer>, options: { store?: boolean } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(parts)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const compressed = options.store ? data : deflateRawSync(data)
    const nameBytes = Buffer.from(name, 'utf8')
    const method = options.store ? 0 : 8
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(parts).length, 8)
  end.writeUInt16LE(Object.keys(parts).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** The parts of a workbook with `sheets`, in order. */
export function workbookParts(sheets: readonly TestSheet[]): Record<string, string> {
  const shared: string[] = []
  const sharedIndex = (text: string) => {
    const existing = shared.indexOf(text)
    if (existing >= 0) return existing
    shared.push(text)
    return shared.length - 1
  }

  const parts: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>' +
      sheets
        .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`)
        .join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
        .join('') +
      '</Relationships>',
    // Style 0: General. Style 1: built-in date format 14. Style 2: a custom yyyy/mm/dd format.
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/></numFmts>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0"/><xf numFmtId="14" fontId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
  }

  sheets.forEach((sheet, index) => {
    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const rowNumber = rowIndex + 1
        const xml = cells
          .map((cell, columnIndex) => {
            const ref = `${columnLetters(columnIndex)}${rowNumber}`
            if (cell === null) return ''
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
            if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`
            if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`
            if ('date' in cell) return `<c r="${ref}" s="1"><v>${cell.date}</v></c>`
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.inline)}</t></is></c>`
          })
          .join('')
        return xml ? `<row r="${rowNumber}">${xml}</row>` : ''
      })
      .join('')
    parts[`xl/worksheets/sheet${index + 1}.xml`] =
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows}</sheetData></worksheet>`
  })
  parts['xl/sharedStrings.xml'] =
    '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('') +
    '</sst>'
  return parts
}

/** An XLSX workbook with `sheets`, in order. */
export function xlsx(sheets: readonly TestSheet[], options: { store?: boolean } = {}): Buffer {
  return zip(workbookParts(sheets), options)
}
