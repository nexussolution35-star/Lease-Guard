import { InternalServerErrorException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, dataApiPage, fakeDb } from '../testing/fake-db.test-helpers'
import { DATA_API_MAX_ROWS, fetchAllRows } from './fetch-all'

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index }))

describe('fetchAllRows', () => {
  it('returns every row beyond the Data API max_rows limit, one range per page', async () => {
    const all = rows(2 * DATA_API_MAX_ROWS + 5)
    const { client, queries } = fakeDb((query) => ({ data: dataApiPage(all, query), error: null }))

    const result = await fetchAllRows('List rows', (from, to) => client.from('statements').select('*').order('id').range(from, to))

    expect(result).toHaveLength(all.length)
    expect(result.at(-1)).toEqual({ id: all.length - 1 })
    expect(queries.map((query) => callsTo(query, 'range')[0])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('makes one extra request when the last page is exactly full', async () => {
    const all = rows(DATA_API_MAX_ROWS)
    const { client, queries } = fakeDb((query) => ({ data: dataApiPage(all, query), error: null }))
    const result = await fetchAllRows('List rows', (from, to) => client.from('statements').select('*').order('id').range(from, to))
    expect(result).toHaveLength(DATA_API_MAX_ROWS)
    expect(queries).toHaveLength(2)
  })

  it('turns a database error into the HTTP error', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'XX000', message: 'boom' } }))
    await expect(
      fetchAllRows('List rows', (from, to) => client.from('statements').select('*').order('id').range(from, to)),
    ).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
