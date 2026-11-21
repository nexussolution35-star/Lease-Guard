import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, sampleRecord, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiLeaseSource } from './apiSource'
import type { NewLease } from './source'

const lease = sampleRecord('leases')

const newLease: NewLease = {
  reference: 'MSQ-L077',
  tenantId: TEST_FILTER_ID,
  propertyId: TEST_FILTER_ID,
  unitId: TEST_FILTER_ID,
  commencementDate: '2026-01-01',
  expiryDate: '2030-12-31',
  initialMonthlyRental: 35000,
  paymentDueDay: 1,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2027-01-01' },
  renewalOption: { exists: false },
}

describe('createApiLeaseSource create and edit', () => {
  it('creates a lease in the explicit company with the body as given', async () => {
    const fetch = fakeFetch(201, lease)
    expect(await createApiLeaseSource(fakeApiClient(fetch)).create(TEST_COMPANY_ID, newLease)).toEqual(lease)

    const request = requestAt(fetch)
    expect(request.method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe('/api/v1/leases')
    expect(request.headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await request.json()).toEqual(newLease)
  })

  it('changes a lease by id with only the fields sent, null removing the guarantee', async () => {
    const fetch = fakeFetch(200, { ...lease, verified: false, status: 'pending_verification' })
    const updated = await createApiLeaseSource(fakeApiClient(fetch)).update(TEST_COMPANY_ID, TEST_RECORD_ID, { currentMonthlyRental: 37800, bankGuarantee: null })
    expect(updated.verified).toBe(false)

    const request = requestAt(fetch)
    expect(request.method).toBe('PATCH')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/leases/${TEST_RECORD_ID}`)
    expect(request.headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await request.json()).toEqual({ currentMonthlyRental: 37800, bankGuarantee: null })
  })

  it('rejects with the API’s words for a reference already used', async () => {
    const message = 'A lease with the reference MSQ-L077 already exists in this workspace'
    const fetch = fakeFetch(409, { statusCode: 409, error: 'Conflict', message, requestId: 'r1' })
    const error = await createApiLeaseSource(fakeApiClient(fetch)).create(TEST_COMPANY_ID, newLease).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).messages).toEqual([message])
  })
})
