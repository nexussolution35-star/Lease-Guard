import { describe, expect, it } from 'vitest'

import { STATEMENT_LIST_DEFAULTS, statementListSearchSchema } from './listSearch'

const PROPERTY_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b'

describe('statementListSearchSchema', () => {
  it('reads every filter from the URL', () => {
    expect(
      statementListSearchSchema.parse({
        search: 'Shop12 ',
        status: 'review_required',
        propertyId: PROPERTY_ID,
        sourceSystem: 'MRI',
        sort: 'statementDate',
        direction: 'asc',
        page: '3',
        pageSize: '50',
      }),
    ).toEqual({
      page: 3,
      pageSize: 50,
      search: 'Shop12 ',
      status: 'review_required',
      propertyId: PROPERTY_ID,
      sourceSystem: 'MRI',
      sort: 'statementDate',
      direction: 'asc',
    })
  })

  it('follows one upload batch, and ignores an empty batch id', () => {
    expect(statementListSearchSchema.parse({ uploadBatchId: 'f3c1a2b4-batch' }).uploadBatchId).toBe('f3c1a2b4-batch')
    expect(statementListSearchSchema.parse({ uploadBatchId: '  ' }).uploadBatchId).toBeUndefined()
  })

  it('defaults to the newest uploads first', () => {
    expect(statementListSearchSchema.parse({})).toEqual({ ...STATEMENT_LIST_DEFAULTS })
  })

  it('falls back to defaults for invalid values instead of failing the route', () => {
    expect(
      statementListSearchSchema.parse({
        page: 'x',
        pageSize: 1000,
        sort: 'closingBalance',
        direction: 'up',
        search: 42,
        status: 'failed',
        propertyId: 'not-a-uuid',
        sourceSystem: 'Excel',
      }),
    ).toEqual({ ...STATEMENT_LIST_DEFAULTS })
  })
})
