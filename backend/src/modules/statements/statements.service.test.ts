import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, dataApiPage, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { statementListQuerySchema } from './statements.schemas'
import { StatementsService } from './statements.service'
import {
  COMPANY,
  extractionFieldRow,
  extractionRow,
  JSON_NULL,
  lineItemRow,
  PROPERTY,
  STATEMENT,
  statementRow,
} from './statements.test-helpers'

const OTHER = '6f1d2c1e-0000-4000-8000-0000000000ee'

describe('StatementsService', () => {
  const service = new StatementsService()

  it('follows one upload batch', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, statementListQuerySchema.parse({ uploadBatchId: ' 0b8f6d1e-batch ' }))
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['upload_batch_id', '0b8f6d1e-batch'],
    ])
  })

  it('lists one company with filters and loads children in one query per table', async () => {
    const { client, queries } = fakeDb((query) => {
      if (query.table === 'statements') return { data: [statementRow(), statementRow({ id: OTHER })], error: null, count: 2 }
      if (query.table === 'statement_line_items') {
        return { data: [lineItemRow(), lineItemRow({ id: 'li-2', line_number: 2, kind: 'payment', category: 'payment' })], error: null }
      }
      return { data: [{ id: 'ext-1', statement_id: STATEMENT }], error: null }
    })
    const query = statementListQuerySchema.parse({
      status: 'uploaded',
      propertyId: PROPERTY,
      sourceSystem: 'MRI',
      sort: 'statementDate',
      direction: 'desc',
      search: 'Shop12',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({ id: STATEMENT, extractionId: 'ext-1' })
    expect(page.items[0]?.lineItems.map((item) => item.kind)).toEqual(['charge', 'payment'])
    expect(page.items[1]).toMatchObject({ id: OTHER, lineItems: [] })
    expect(page.items[1]).not.toHaveProperty('extractionId')

    const [statements, lineItems, extractions] = queries
    expect(callsTo(statements!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'uploaded'],
      ['property_id', PROPERTY],
      ['source_system', 'MRI'],
    ])
    expect(callsTo(statements!, 'or')).toEqual([['file_name.ilike."%Shop12%",statement_number.ilike."%Shop12%"']])
    expect(callsTo(statements!, 'order')[0]).toEqual(['statement_date', { ascending: false }])
    for (const child of [lineItems!, extractions!]) {
      expect(callsTo(child, 'eq')).toEqual([['company_id', COMPANY]])
      expect(callsTo(child, 'in')).toEqual([['statement_id', [STATEMENT, OTHER]]])
    }
  })

  it('names the property and, once matched, the tenant and unit of each row', async () => {
    const { client, queries } = fakeDb((query) => {
      if (query.table === 'statements') {
        return {
          data: [
            { ...statementRow(), property: { name: 'Acacia Park' }, tenant: { trading_name: 'Umoya Coffee' }, unit: { unit_number: 'G12' } },
            { ...statementRow({ id: OTHER, tenant_id: null }), property: { name: 'Acacia Park' }, tenant: null, unit: null },
          ],
          error: null,
          count: 2,
        }
      }
      return { data: [], error: null }
    })

    const page = await service.list(client, COMPANY, statementListQuerySchema.parse({}))

    expect(callsTo(queries[0]!, 'select')[0]?.[0]).toContain('property:properties!statements_property_fk(name)')
    expect(page.items[0]).toMatchObject({ id: STATEMENT, propertyName: 'Acacia Park', tenantName: 'Umoya Coffee', unitNumber: 'G12' })
    expect(page.items[1]).toMatchObject({ id: OTHER, propertyName: 'Acacia Park' })
    expect(page.items[1]).not.toHaveProperty('tenantName')
    expect(page.items[1]).not.toHaveProperty('unitNumber')
    // The embeds are not leaked into the statement itself.
    expect(page.items[0]).not.toHaveProperty('property')
    expect(page.items[0]).not.toHaveProperty('tenant')
  })

  it('marks the statements ready to verify: under review, matched and with nothing unresolved', async () => {
    const UNIT = '6f1d2c1e-0000-4000-8000-0000000000e1'
    const LEASE = '6f1d2c1e-0000-4000-8000-0000000000f1'
    const FLAGGED = '6f1d2c1e-0000-4000-8000-0000000000a5'
    const UNMATCHED = '6f1d2c1e-0000-4000-8000-0000000000a6'
    const VERIFIED = '6f1d2c1e-0000-4000-8000-0000000000a7'
    const extractionOf = (id: string) => `${id.slice(0, -3)}e${id.slice(-2)}`
    const matched = { status: 'review_required' as const, tenant_id: PROPERTY, unit_id: UNIT, lease_id: LEASE }
    const values = {
      tenant_name: 'Umoya Coffee',
      unit_number: 'G12',
      statement_number: 'ST-1',
      statement_date: '2026-10-31',
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      opening_balance: 0,
      rental_charged: 100,
      additional_charges: 0,
      payments_received: 0,
      outstanding_balance: 100,
      total_due: 100,
    } as const
    const fieldsOf = (statementId: string, flagged: boolean) =>
      Object.entries(values).map(([name, value], index) =>
        extractionFieldRow({
          id: `${statementId.slice(0, -2)}${String(index).padStart(2, '0')}`,
          extraction_id: extractionOf(statementId),
          name: name as keyof typeof values,
          value,
          flagged: flagged && name === 'total_due',
        }),
      )
    const { client, queries } = fakeDb((query) => {
      if (query.table === 'statements') {
        return {
          data: [
            statementRow(matched),
            statementRow({ ...matched, id: FLAGGED }),
            statementRow({ ...matched, id: UNMATCHED, lease_id: null }),
            statementRow({ ...matched, id: VERIFIED, status: 'verified' }),
          ],
          error: null,
          count: 4,
        }
      }
      if (query.table === 'statement_extractions') {
        if (callsTo(query, 'select')[0]?.[0] === 'id, statement_id') {
          return { data: [STATEMENT, FLAGGED, UNMATCHED, VERIFIED].map((id) => ({ id: extractionOf(id), statement_id: id })), error: null }
        }
        return { data: [STATEMENT, FLAGGED].map((id) => extractionRow({ id: extractionOf(id), statement_id: id })), error: null }
      }
      if (query.table === 'statement_extraction_fields') return { data: [...fieldsOf(STATEMENT, false), ...fieldsOf(FLAGGED, true)], error: null }
      if (query.table === 'leases') {
        return { data: [{ id: LEASE, reference: 'L-1', status: 'active', commencement_date: '2026-01-01', expiry_date: '2030-12-31' }], error: null }
      }
      return { data: [], error: null }
    })

    const page = await service.list(client, COMPANY, statementListQuerySchema.parse({}))

    expect(page.items.map((item) => [item.id, item.readyToVerify])).toEqual([
      [STATEMENT, true],
      [FLAGGED, false],
      [UNMATCHED, false],
      [VERIFIED, false],
    ])
    // Only the matched statements under review are checked, in one query per table.
    const fields = queries.find((query) => query.table === 'statement_extraction_fields')!
    expect(callsTo(fields, 'in')).toEqual([['extraction_id', [extractionOf(STATEMENT), extractionOf(FLAGGED)]]])
    expect(callsTo(queries.find((query) => query.table === 'leases')!, 'in')).toEqual([['id', [LEASE]]])
  })

  it('reads nothing more when no statement of the page is matched and under review', async () => {
    const { client, queries } = fakeDb((query) => (query.table === 'statements' ? { data: [statementRow()], error: null, count: 1 } : { data: [], error: null }))
    const page = await service.list(client, COMPANY, statementListQuerySchema.parse({}))
    expect(page.items[0]?.readyToVerify).toBe(false)
    expect(queries.map((query) => query.table)).toEqual(['statements', 'statement_line_items', 'statement_extractions'])
  })

  it('returns every line item of a page beyond the Data API max_rows limit, ordered for stable paging', async () => {
    const items = [
      ...Array.from({ length: 1500 }, (_, index) => lineItemRow({ id: `a-${index}`, line_number: index + 1 })),
      ...Array.from({ length: 700 }, (_, index) => lineItemRow({ id: `b-${index}`, statement_id: OTHER, line_number: index + 1 })),
    ]
    const { client, queries } = fakeDb((query) => {
      if (query.table === 'statements') return { data: [statementRow(), statementRow({ id: OTHER })], error: null, count: 2 }
      if (query.table === 'statement_line_items') return { data: dataApiPage(items, query), error: null }
      return { data: [], error: null }
    })

    const page = await service.list(client, COMPANY, statementListQuerySchema.parse({}))

    expect(page.items[0]?.lineItems).toHaveLength(1500)
    expect(page.items[0]?.lineItems.at(-1)?.id).toBe('a-1499')
    expect(page.items[1]?.lineItems).toHaveLength(700)
    const lineItemQueries = queries.filter((query) => query.table === 'statement_line_items')
    expect(lineItemQueries.map((query) => callsTo(query, 'range')[0])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
    expect(callsTo(lineItemQueries[0]!, 'order')).toEqual([
      ['statement_id', { ascending: true }],
      ['line_number', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('returns every line item of one statement beyond the Data API max_rows limit', async () => {
    const items = Array.from({ length: 1001 }, (_, index) => lineItemRow({ id: `a-${index}`, line_number: index + 1 }))
    const { client } = fakeDb((query) =>
      query.table === 'statements'
        ? { data: statementRow(), error: null }
        : { data: query.table === 'statement_line_items' ? dataApiPage(items, query) : [], error: null },
    )
    const statement = await service.get(client, COMPANY, STATEMENT)
    expect(statement.lineItems).toHaveLength(1001)
  })

  it('skips child queries for an empty page', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    const page = await service.list(client, COMPANY, statementListQuerySchema.parse({}))
    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 25 })
    expect(queries).toHaveLength(1)
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['uploaded_at', { ascending: true }])
  })

  it('returns 404 when the statement is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, STATEMENT)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns the extraction with its fields, scoped to the company', async () => {
    const { client, queries } = fakeDb((query) =>
      query.table === 'statement_extractions'
        ? { data: extractionRow(), error: null }
        : { data: [extractionFieldRow({ name: 'total_due', value: JSON_NULL, flagged: true })], error: null },
    )

    const extraction = await service.getExtraction(client, COMPANY, STATEMENT)

    expect(extraction.fields).toEqual([expect.objectContaining({ name: 'total_due', value: JSON_NULL, flagged: true })])
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['statement_id', STATEMENT],
    ])
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['extraction_id', extractionRow().id],
    ])
  })

  it('returns 404 when the statement has no extraction yet', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.getExtraction(client, COMPANY, STATEMENT)).rejects.toThrow('The statement has no extraction yet')
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, statementListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
