import { unwrap, type ApiClient } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { xlsx } from '../../backend/src/modules/portfolio-imports/spreadsheet/xlsx.test-helpers.ts'
import { apiAs, apiErrorOf, check, serviceRole, world } from './support/clients.ts'
import { auditCount } from './support/local-db.ts'

/**
 * Uploading a portfolio file (ticket I-01) through the real API, the local database and storage: a writer uploads a
 * CSV or XLSX file to the signed URL, the API reads it and records the batch with its rows; the original stays in the
 * private bucket; empty, oversized and over-limit files are refused with a message; members who only read are
 * refused; another company's batch is not found; and creating a batch reaches the audit log.
 */

const CSV = Buffer.from(
  '\ufeffProperty code;Property name;Unit number;Floor area (m²)\r\nZPA;Integration Plaza;Shop 1;145,5\r\n;;;\r\nZPA;Integration Plaza;Shop 2;80\r\n',
  'utf8',
)

/** Signs, uploads and records `file` as `client`; returns the batch. */
async function upload(client: ApiClient, fileName: string, file: Buffer, body: { scope: 'properties' | 'units'; propertyId?: string; sheetName?: string }) {
  const target = await unwrap(client.POST('/api/v1/portfolio-imports/upload-url', { body: { fileName, sizeBytes: file.length } }))
  const put = await fetch(target.signedUrl, { method: 'PUT', headers: { 'content-type': target.contentType }, body: new Uint8Array(file) })
  expect(put.ok, `storage answered ${put.status}`).toBe(true)
  return client.POST('/api/v1/portfolio-imports', {
    body: { ...body, storagePath: target.storagePath, fileName, sizeBytes: file.length },
  })
}

describe('portfolio imports: upload', () => {
  it('reads a semicolon CSV with a byte-order mark into a batch, keeps the original and audits it', async () => {
    const manager = apiAs('manager', 'a')
    const batch = await unwrap(upload(manager, 'Rent roll.csv', CSV, { scope: 'properties' }))
    expect(batch).toMatchObject({
      companyId: world().companies.a.id,
      scope: 'properties',
      fileName: 'Rent roll.csv',
      fileFormat: 'csv',
      delimiter: ';',
      sheetNames: [],
      columns: ['Property code', 'Property name', 'Unit number', 'Floor area (m²)'],
      rowCount: 2,
      sizeBytes: CSV.length,
      uploadedByUserId: world().users.manager.id,
    })
    expect(batch).not.toHaveProperty('sheetName')

    const rows = check(
      await serviceRole().from('portfolio_import_rows').select('row_number, cells').eq('import_id', batch.id).order('row_number'),
      'Read the batch rows',
    )
    expect(rows).toEqual([
      { row_number: 2, cells: ['ZPA', 'Integration Plaza', 'Shop 1', '145,5'] },
      { row_number: 4, cells: ['ZPA', 'Integration Plaza', 'Shop 2', '80'] },
    ])
    const stored = check(await serviceRole().from('portfolio_imports').select('storage_path').eq('id', batch.id).single(), 'Read the batch')
    const original = await serviceRole().storage.from('portfolio-imports').download(stored.storage_path)
    expect(Buffer.from(await original.data!.arrayBuffer()).equals(CSV)).toBe(true)
    expect(await auditCount(batch.id)).toBe(1)

    // Members who only read see the batch; nothing was written to properties.
    const read = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/portfolio-imports/{importId}', { params: { path: { importId: batch.id } } }))
    expect(read.rowCount).toBe(2)
    const properties = check(await serviceRole().from('properties').select('id').eq('company_id', world().companies.a.id).eq('code', 'ZPA'), 'Look for ZPA')
    expect(properties).toEqual([])

    const other = await apiErrorOf(unwrap(apiAs('manager', 'b').GET('/api/v1/portfolio-imports/{importId}', { params: { path: { importId: batch.id } } })))
    expect(other.status).toBe(404)
  })

  it('reads units for a property from an XLSX workbook, from its first sheet or another one chosen afterwards', async () => {
    const property = world().companies.a.properties.find((p) => p.code === 'ACP')!
    const workbook = xlsx([
      { name: 'Units', rows: [['Unit number', 'Floor area (m²)'], ['Shop 9', 120.25], [null, null], ['Shop 10', 64]] },
      { name: 'Parking', rows: [['Bay'], ['P1']] },
    ])
    const admin = apiAs('admin', 'a')
    const batch = await unwrap(upload(admin, 'units.xlsx', workbook, { scope: 'units', propertyId: property.id }))
    expect(batch).toMatchObject({
      scope: 'units',
      propertyId: property.id,
      fileFormat: 'xlsx',
      sheetName: 'Units',
      sheetNames: ['Units', 'Parking'],
      columns: ['Unit number', 'Floor area (m²)'],
      rowCount: 2,
    })

    const chosen = await unwrap(
      admin.POST('/api/v1/portfolio-imports/{importId}/sheet', { params: { path: { importId: batch.id } }, body: { sheetName: 'Parking' } }),
    )
    expect(chosen).toMatchObject({ sheetName: 'Parking', columns: ['Bay'], rowCount: 1 })
    expect(await auditCount(batch.id)).toBe(2)

    const missing = await apiErrorOf(
      unwrap(admin.POST('/api/v1/portfolio-imports/{importId}/sheet', { params: { path: { importId: batch.id } }, body: { sheetName: 'Leases' } })),
    )
    expect(missing.status).toBe(422)
    expect(missing.messages.join(' ')).toBe('The workbook has no sheet named "Leases"')
  })

  it('refuses an empty file and a file with headings only (422), recording nothing', async () => {
    const manager = apiAs('manager', 'a')
    const empty = await apiErrorOf(unwrap(upload(manager, 'empty.csv', Buffer.from('\ufeff\r\n;;\r\n', 'utf8'), { scope: 'properties' })))
    expect(empty.status).toBe(422)
    expect(empty.messages.join(' ')).toBe('The file is empty. Check that you chose the right file, or the right sheet.')

    const headings = await apiErrorOf(unwrap(upload(manager, 'headings.xlsx', xlsx([{ name: 'Sheet1', rows: [['Unit number']] }]), { scope: 'properties' })))
    expect(headings.status).toBe(422)
    expect(headings.messages.join(' ')).toBe('The file has column headings but no rows below them.')
  })

  it('refuses a file over 5 MB (413) and over the row limit (422)', async () => {
    const manager = apiAs('manager', 'a')
    const tooBig = await apiErrorOf(unwrap(manager.POST('/api/v1/portfolio-imports/upload-url', { body: { fileName: 'big.csv', sizeBytes: 6 * 1024 * 1024 } })))
    expect(tooBig.status).toBe(413)
    expect(tooBig.messages.join(' ')).toBe('The file is larger than the 5 MB limit for portfolio files')

    const rows = Array.from({ length: 5001 }, (_, index) => `Z${index},Name`).join('\n')
    const many = await apiErrorOf(unwrap(upload(manager, 'many.csv', Buffer.from(`Code,Name\n${rows}\n`, 'utf8'), { scope: 'properties' })))
    expect(many.status).toBe(422)
    expect(many.messages.join(' ')).toMatch(/^The file has 5 001 rows; at most 5 000 rows can be imported at once/)
  })

  it('refuses members who only read and property owners (403), and units without a property (400)', async () => {
    for (const user of ['readOnly', 'owner'] as const) {
      const refused = await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/portfolio-imports/upload-url', { body: { fileName: 'x.csv', sizeBytes: 10 } })))
      expect(refused.status).toBe(403)
      const create = await apiErrorOf(
        unwrap(
          apiAs(user, 'a').POST('/api/v1/portfolio-imports', {
            body: { scope: 'properties', storagePath: `${world().companies.a.id}/${crypto.randomUUID()}/x.csv`, fileName: 'x.csv', sizeBytes: 10 },
          }),
        ),
      )
      expect(create.status).toBe(403)
    }
    const invalid = await apiErrorOf(
      unwrap(
        apiAs('manager', 'a').POST('/api/v1/portfolio-imports', {
          body: { scope: 'units', storagePath: `${world().companies.a.id}/${crypto.randomUUID()}/x.csv`, fileName: 'x.pdf', sizeBytes: 10 },
        }),
      ),
    )
    expect(invalid.status).toBe(400)
    expect(invalid.messages.join(' ')).toMatch(/fileName: must be a \.csv or \.xlsx file/)
  })
})

describe('portfolio imports: Google Sheets link (ticket I-06)', () => {
  const LINK = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'

  it('refuses a link that is not a Google Sheets link (400) and members who only read or own (403), fetching nothing', async () => {
    for (const url of ['https://example.com/rent-roll.csv', 'http://169.254.169.254/latest/meta-data', `https://docs.google.com.evil.example/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`]) {
      const refused = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/portfolio-imports/google-sheets', { body: { scope: 'properties', url } })))
      expect(refused.status, url).toBe(400)
      expect(refused.messages.join(' ')).toMatch(/must be a Google Sheets link/)
    }
    for (const user of ['readOnly', 'owner'] as const) {
      const refused = await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/portfolio-imports/google-sheets', { body: { scope: 'properties', url: LINK } })))
      expect(refused.status).toBe(403)
    }
  })
})
