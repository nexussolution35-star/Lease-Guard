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

  it('records, edits, closes and cancels in the explicit company with exactly the body given', async () => {
    const body = {
      tenantId: TEST_FILTER_ID,
      propertyId: TEST_FILTER_ID,
      outstandingBalance: 10_000,
      installmentAmount: 2_500,
      frequency: 'monthly' as const,
      firstInstallmentDate: '2026-12-01',
    }
    const created = fakeFetch(201, arrangement)
    expect(await sourceWith(created).create(TEST_COMPANY_ID, body)).toEqual(arrangement)
    expect(requestAt(created).method).toBe('POST')
    expect(urlOf(created).pathname).toBe('/api/v1/arrangements')
    expect(requestAt(created).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(created).json()).toEqual(body)

    const edited = fakeFetch(200, arrangement)
    await sourceWith(edited).update(TEST_COMPANY_ID, TEST_RECORD_ID, { notes: 'Called the tenant' })
    expect(requestAt(edited).method).toBe('PATCH')
    expect(urlOf(edited).pathname).toBe(`/api/v1/arrangements/${TEST_RECORD_ID}`)
    expect(await requestAt(edited).json()).toEqual({ notes: 'Called the tenant' })

    const closed = fakeFetch(200, arrangement)
    await sourceWith(closed).close(TEST_COMPANY_ID, TEST_RECORD_ID, { outcome: 'completed' })
    expect(urlOf(closed).pathname).toBe(`/api/v1/arrangements/${TEST_RECORD_ID}/close`)
    expect(await requestAt(closed).json()).toEqual({ outcome: 'completed' })

    const cancelled = fakeFetch(200, arrangement)
    await sourceWith(cancelled).cancel(TEST_COMPANY_ID, TEST_RECORD_ID, { reason: 'Paid in full' })
    expect(urlOf(cancelled).pathname).toBe(`/api/v1/arrangements/${TEST_RECORD_ID}/cancel`)
    expect(requestAt(cancelled).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('records an instalment outcome on its arrangement', async () => {
    const fetch = fakeFetch(200, arrangement)
    await sourceWith(fetch).recordInstallmentOutcome(TEST_COMPANY_ID, TEST_RECORD_ID, TEST_FILTER_ID, { outcome: 'missed', note: 'Tenant confirmed' })
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/arrangements/${TEST_RECORD_ID}/installments/${TEST_FILTER_ID}/outcome`)
    expect(await requestAt(fetch).json()).toEqual({ outcome: 'missed', note: 'Tenant confirmed' })
  })
})
