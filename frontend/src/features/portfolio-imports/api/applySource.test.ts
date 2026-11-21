import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiPortfolioImportApplySource } from './applySource'

const SUMMARY = {
  importId: TEST_RECORD_ID,
  propertiesToCreate: 2,
  unitsToCreate: 4,
  linkedRows: 0,
  skippedRows: 0,
  blockedRows: 1,
  canApprove: true,
  needsAccountingSystem: true,
  created: [],
}

describe('createApiPortfolioImportApplySource', () => {
  it('reads the summary of a batch in the active company', async () => {
    const get = fakeFetch(200, SUMMARY)
    await expect(createApiPortfolioImportApplySource(fakeApiClient(get)).getSummary(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toEqual(SUMMARY)
    expect(urlOf(get).pathname).toBe(`/api/v1/portfolio-imports/${TEST_RECORD_ID}/summary`)
    expect(requestAt(get).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('approves with POST and the accounting system', async () => {
    const post = fakeFetch(200, { ...SUMMARY, propertiesToCreate: 0, unitsToCreate: 0, canApprove: false })
    await createApiPortfolioImportApplySource(fakeApiClient(post)).approve(TEST_COMPANY_ID, TEST_RECORD_ID, { accountingSystem: 'MRI' })
    expect(requestAt(post).method).toBe('POST')
    expect(urlOf(post).pathname).toBe(`/api/v1/portfolio-imports/${TEST_RECORD_ID}/approve`)
    expect(await requestAt(post).json()).toEqual({ accountingSystem: 'MRI' })
  })
})
