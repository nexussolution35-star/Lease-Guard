import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, forbiddenFetch, requestAt, TEST_COMPANY_ID, urlOf } from '@/test/fakeApi'

import { createApiStatementArrearsSource } from './arrearsSource'

const summary = {
  asOf: '2026-11-21',
  ageingBuckets: [30, 60, 90, 120],
  totalOutstanding: 0,
  tenantsInArrears: 0,
  tenantsUnderArrangement: 0,
  pendingReview: 0,
  buckets: [],
  entries: [],
}

describe('createApiStatementArrearsSource', () => {
  it('reads the summary for the explicit company', async () => {
    const fetch = fakeFetch(200, summary)
    expect(await createApiStatementArrearsSource(fakeApiClient(fetch)).summary(TEST_COMPANY_ID)).toEqual(summary)
    expect(urlOf(fetch).pathname).toBe('/api/v1/statements/arrears')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('surfaces API errors', async () => {
    await expect(createApiStatementArrearsSource(fakeApiClient(forbiddenFetch())).summary(TEST_COMPANY_ID)).rejects.toMatchObject({ status: 403 })
  })
})
