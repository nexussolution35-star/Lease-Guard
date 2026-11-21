import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, notFoundFetch, requestAt, sampleRecord, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf, type FakeFetch } from '@/test/fakeApi'

import { createApiStatementSource } from './apiSource'

const statement = sampleRecord('statements')
const extraction = {
  id: TEST_FILTER_ID,
  companyId: TEST_COMPANY_ID,
  statementId: TEST_RECORD_ID,
  engine: 'leaseguard-pdf',
  extractedAt: '2026-11-01T08:05:00Z',
  overallConfidence: 0.8,
  fields: [{ name: 'rental_charged', rawText: 'R 37 800,00', value: 37800, confidence: 0.6, flagged: true, resolution: 'unresolved' }],
  matchConfidence: 0,
  status: 'pending_review',
  issues: [],
  createdAt: '2026-11-01T08:05:00Z',
  updatedAt: '2026-11-01T08:05:00Z',
}

const sourceWith = (fetch: FakeFetch) => createApiStatementSource(fakeApiClient(fetch))

describe('createApiStatementSource review', () => {
  it('reads the extraction with the explicit company and maps 404 (not yet extracted) to null', async () => {
    const found = fakeFetch(200, extraction)
    expect(await sourceWith(found).getExtraction(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(extraction)
    expect(urlOf(found).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/extraction`)
    expect(requestAt(found).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await sourceWith(notFoundFetch()).getExtraction(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('gets the short-lived link to the original file', async () => {
    const fetch = fakeFetch(200, { url: 'http://storage/object/sign/s?token=t', expiresInSeconds: 300 })
    expect(await sourceWith(fetch).downloadUrl(TEST_COMPANY_ID, TEST_RECORD_ID)).toBe('http://storage/object/sign/s?token=t')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/download-url`)
  })

  it('corrects a field with PUT and its value, and confirms one with POST', async () => {
    const corrected = fakeFetch(200, extraction)
    await sourceWith(corrected).correctField(TEST_COMPANY_ID, TEST_RECORD_ID, 'rental_charged', 38000)
    expect(requestAt(corrected).method).toBe('PUT')
    expect(urlOf(corrected).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/extraction/fields/rental_charged/correction`)
    expect(await requestAt(corrected).json()).toEqual({ value: 38000 })
    expect(requestAt(corrected).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    const confirmed = fakeFetch(200, extraction)
    expect(await sourceWith(confirmed).confirmField(TEST_COMPANY_ID, TEST_RECORD_ID, 'statement_date')).toEqual(extraction)
    expect(requestAt(confirmed).method).toBe('POST')
    expect(urlOf(confirmed).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/extraction/fields/statement_date/confirm`)
  })

  it('sets the match with PUT and rethrows a refusal', async () => {
    const fetch = fakeFetch(200, statement)
    const match = { tenantId: TEST_FILTER_ID, unitId: TEST_FILTER_ID }
    expect(await sourceWith(fetch).setMatch(TEST_COMPANY_ID, TEST_RECORD_ID, match)).toEqual(statement)
    expect(requestAt(fetch).method).toBe('PUT')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/statements/${TEST_RECORD_ID}/match`)
    expect(await requestAt(fetch).json()).toEqual(match)

    const refused = fakeFetch(422, { statusCode: 422, error: 'Unprocessable Entity', message: ['No lease'], requestId: null })
    const error = await sourceWith(refused).setMatch(TEST_COMPANY_ID, TEST_RECORD_ID, match).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
  })
})
