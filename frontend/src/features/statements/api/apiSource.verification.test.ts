import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, sampleRecord, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf, type FakeFetch } from '@/test/fakeApi'

import { createApiStatementSource } from './apiSource'

const statement = sampleRecord('statements')
const sourceWith = (fetch: FakeFetch) => createApiStatementSource(fakeApiClient(fetch))

describe('createApiStatementSource review outcome', () => {
  it('verifies with POST and the explicit company, returning the statement and whether monitoring was queued', async () => {
    const fetch = fakeFetch(200, { statement, monitoringQueued: true })
    expect(await sourceWith(fetch).verify(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual({ statement, monitoringQueued: true })
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/verify`)
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('rethrows a refused verification with every reason', async () => {
    const reasons = ['The total due is flagged: confirm or correct it', 'The lease is not set']
    const refused = fakeFetch(422, { statusCode: 422, error: 'Unprocessable Entity', message: reasons, requestId: null })
    const error = await sourceWith(refused).verify(TEST_COMPANY_ID, TEST_RECORD_ID).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
  })

  it('rejects with the reason and marks a duplicate with the other statement', async () => {
    const rejected = fakeFetch(200, statement)
    expect(await sourceWith(rejected).reject(TEST_COMPANY_ID, TEST_RECORD_ID, 'Not our tenant')).toEqual(statement)
    expect(urlOf(rejected).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/reject`)
    expect(await requestAt(rejected).json()).toEqual({ reason: 'Not our tenant' })

    const duplicate = fakeFetch(200, statement)
    await sourceWith(duplicate).markDuplicate(TEST_COMPANY_ID, TEST_RECORD_ID, TEST_FILTER_ID)
    expect(requestAt(duplicate).method).toBe('POST')
    expect(urlOf(duplicate).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/mark-duplicate`)
    expect(await requestAt(duplicate).json()).toEqual({ duplicateOfStatementId: TEST_FILTER_ID })
  })

  it('verifies several statements with one POST, returning who was verified and why the others were not', async () => {
    const result = {
      verified: [{ statementId: TEST_RECORD_ID, fileName: 'October.pdf', monitoringQueued: true }],
      notVerified: [{ statementId: TEST_FILTER_ID, fileName: 'November.pdf', reasons: ['The lease is not set'] }],
    }
    const fetch = fakeFetch(200, result)
    expect(await sourceWith(fetch).verifyMany(TEST_COMPANY_ID, [TEST_RECORD_ID, TEST_FILTER_ID])).toEqual(result)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe('/api/v1/statements/verify')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(fetch).json()).toEqual({ statementIds: [TEST_RECORD_ID, TEST_FILTER_ID] })
  })
})
