import { describe, expect, it, vi } from 'vitest'

import { csvAmount, csvPercent, downloadCsv, reportFileName, toCsv, type CsvColumn } from './csv'

interface Row {
  name: string
  amount: number
  note?: string
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Tenant', value: (row) => row.name },
  { header: 'Outstanding (ZAR)', value: (row) => csvAmount(row.amount) },
  { header: 'Note', value: (row) => row.note },
]

describe('toCsv', () => {
  it('writes a header and one CRLF line per row', () => {
    expect(toCsv(COLUMNS, [{ name: 'Fresh Mart', amount: 1500.5 }])).toBe('Tenant,Outstanding (ZAR),Note\r\nFresh Mart,1500.50,\r\n')
    expect(toCsv(COLUMNS, [])).toBe('Tenant,Outstanding (ZAR),Note\r\n')
  })

  it('quotes commas, quotes, line breaks and surrounding spaces', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Dlamini, "Cellular"', amount: 0, note: 'line\nbreak' }])
    expect(csv.split('\r\n')[1]).toBe('"Dlamini, ""Cellular""",0.00,"line\nbreak"')
    expect(toCsv([{ header: 'x', value: () => ' padded' }], [{}])).toContain('" padded"')
  })

  it('keeps text that looks like a formula as text', () => {
    expect(toCsv([{ header: 'x', value: () => '=HYPERLINK("x")' }], [{}]).split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")"`)
    expect(toCsv([{ header: 'x', value: () => -12.5 }], [{}]).split('\r\n')[1]).toBe('-12.5')
  })
})

describe('formatting helpers', () => {
  it('formats amounts, rates and file names', () => {
    expect(csvAmount(12960)).toBe('12960.00')
    expect(csvPercent(0.755)).toBe('75.5')
    expect(reportFileName('portfolio_overview', '2026-11-21')).toBe('leaseguard-portfolio-overview-2026-11-21.csv')
  })
})

describe('downloadCsv', () => {
  it('saves the text as a UTF-8 CSV file and releases the object URL', async () => {
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:report')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadCsv('report.csv', 'a,b\r\n')

    expect(click).toHaveBeenCalledOnce()
    const blob = create.mock.calls[0]?.[0]
    expect(blob?.type).toBe('text/csv;charset=utf-8')
    // The byte order mark first (text() would decode it away), then the CSV.
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('a,b\r\n')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledWith('blob:report')
    expect(document.querySelector('a[download]')).toBeNull()
    click.mockRestore()
  })
})
