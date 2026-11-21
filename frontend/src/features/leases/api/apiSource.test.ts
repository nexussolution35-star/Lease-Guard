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

import { createApiLeaseSource } from './apiSource'

const lease = sampleRecord('leases')

function sourceWith(fetch: FakeFetch) {
  return createApiLeaseSource(fakeApiClient(fetch))
}

describe('createApiLeaseSource', () => {
  it('lists with the explicit company and every set parameter, exactly as the endpoint accepts them', async () => {
    const fetch = fakeFetch(200, { items: [lease], total: 1, page: 2, pageSize: 10 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 2, pageSize: 10, search: ' needle ', sort: 'expiryDate', direction: 'asc', status: 'active', propertyId: TEST_FILTER_ID, unitId: TEST_FILTER_ID, tenantId: TEST_FILTER_ID, verified: false, expiresWithinDays: 90 })

    expect(page).toEqual({ items: [lease], total: 1, page: 2, pageSize: 10 })
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/leases',
      query: { page: '2', pageSize: '10', search: 'needle', sort: 'expiryDate', direction: 'asc', status: 'active', propertyId: TEST_FILTER_ID, unitId: TEST_FILTER_ID, tenantId: TEST_FILTER_ID, verified: 'false', expiresWithinDays: '90' },
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
    const found = fakeFetch(200, lease)
    expect(await sourceWith(found).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(lease)
    expect(urlOf(found).pathname).toBe(`/api/v1/leases/${TEST_RECORD_ID}`)
    expect(requestAt(found).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    expect(await sourceWith(notFoundFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('answers not found for non-UUID ids without calling the API', async () => {
    const fetch = fakeFetch(200, lease)
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

describe('createApiLeaseSource writes and documents', () => {
  it('verifies a lease for the explicit company and returns the stamped lease', async () => {
    const stamped = { ...lease, verified: true, verifiedByUserId: TEST_FILTER_ID, verifiedAt: '2026-11-20T10:00:00.000Z' }
    const fetch = fakeFetch(200, stamped)
    expect(await sourceWith(fetch).verify(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(stamped)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/leases/${TEST_RECORD_ID}/verify`)
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('rejects a verification the role may not make', async () => {
    const error = await sourceWith(forbiddenFetch()).verify(TEST_COMPANY_ID, TEST_RECORD_ID).catch((e: unknown) => e)
    expect((error as ApiError).status).toBe(403)
  })

  it('lists the lease documents for the explicit company', async () => {
    const document = {
      id: TEST_FILTER_ID,
      companyId: TEST_COMPANY_ID,
      leaseId: TEST_RECORD_ID,
      documentType: 'signed_lease',
      title: 'Signed lease',
      file: { fileName: 'signed.pdf', storagePath: `${TEST_COMPANY_ID}/${TEST_FILTER_ID}/signed.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, sha256: 'a'.repeat(64) },
      uploadedByUserId: TEST_FILTER_ID,
      uploadedAt: '2026-03-02T09:15:00.000Z',
      createdAt: '2026-03-02T09:15:00.000Z',
      updatedAt: '2026-03-02T09:15:00.000Z',
    }
    const fetch = fakeFetch(200, [document])
    expect(await sourceWith(fetch).listDocuments(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual([document])
    expect(urlOf(fetch).pathname).toBe(`/api/v1/leases/${TEST_RECORD_ID}/documents`)
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })
})
