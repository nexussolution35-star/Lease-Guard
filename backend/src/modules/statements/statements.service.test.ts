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
