import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import {
  fakeApiClient,
  fakeFetch,
  forbiddenFetch,
  notFoundFetch,
  requestAt,
  sampleRecord,
  TEST_COMPANY_ID,
  TEST_FILTER_ID,
  TEST_RECORD_ID,
  urlOf,
  type FakeFetch,
} from '@/test/fakeApi'

import { createApiArrangementSource } from './apiSource'

const arrangement = sampleRecord('paymentArrangements')

function sourceWith(fetch: FakeFetch) {
  return createApiArrangementSource(fakeApiClient(fetch))
}

describe('createApiArrangementSource', () => {
  it('lists with the explicit company and every set parameter, exactly as the endpoint accepts them', async () => {
    const fetch = fakeFetch(200, { items: [arrangement], total: 1, page: 2, pageSize: 10 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 2, pageSize: 10, search: ' needle ', sort: 'agreedOn', direction: 'desc', status: 'active', leaseId: TEST_FILTER_ID, tenantId: TEST_FILTER_ID })

    expect(page).toEqual({ items: [arrangement], total: 1, page: 2, pageSize: 10 })
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/arrangements',
      query: { page: '2', pageSize: '10', search: 'needle', sort: 'agreedOn', direction: 'desc', status: 'active', leaseId: TEST_FILTER_ID, tenantId: TEST_FILTER_ID },
    })
    // The company in the query key wins over the client's default company.
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(requestAt(fetch).headers.get('Authorization')).toBe('Bearer token')
  })

  it('sends only paging when no search, sort or filter is set', async () => {
    const fetch = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 })
    await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 1, pageSize: 25, search: '  ' })
    expect(urlOf(fetch).query).toEqual({ page: '1', pageSize: '25' })
  })

  it('gets one record by id and maps 404 to null', async () => {
    const found = fakeFetch(200, arrangement)
    expect(await sourceWith(found).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(arrangement)
    expect(urlOf(found).pathname).toBe(`/api/v1/arrangements/${TEST_RECORD_ID}`)
    expect(requestAt(found).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    expect(await sourceWith(notFoundFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('answers not found for non-UUID ids without calling the API', async () => {
    const fetch = fakeFetch(200, arrangement)
    expect(await sourceWith(fetch).get(TEST_COMPANY_ID, 'demo_record_id')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rethrows other API errors', async () => {
    const error = await sourceWith(forbiddenFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
    const listError = await sourceWith(forbiddenFetch()).list(TEST_COMPANY_ID, { page: 1, pageSize: 25 }).catch((e: unknown) => e)
    expect((listError as ApiError).status).toBe(403)
  })
})
