import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiPortfolioImportPreviewSource } from './previewSource'

const MAPPING = { importId: TEST_RECORD_ID, source: 'suggested', fields: [{ field: 'unitNumber', column: 'Unit' }] }

describe('createApiPortfolioImportPreviewSource', () => {
  it('reads the mapping of a batch in the active company', async () => {
    const get = fakeFetch(200, MAPPING)
    await expect(createApiPortfolioImportPreviewSource(fakeApiClient(get)).getMapping(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toEqual(MAPPING)
    expect(urlOf(get).pathname).toBe(`/api/v1/portfolio-imports/${TEST_RECORD_ID}/mapping`)
    expect(requestAt(get).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('applies a mapping with PUT', async () => {
    const put = fakeFetch(200, { ...MAPPING, source: 'applied' })
    await createApiPortfolioImportPreviewSource(fakeApiClient(put)).saveMapping(TEST_COMPANY_ID, TEST_RECORD_ID, { unitNumber: 'Unit' })
    expect(requestAt(put).method).toBe('PUT')
    expect(await requestAt(put).json()).toEqual({ mapping: { unitNumber: 'Unit' } })
  })

  it('reads a page of the preview, with the result filter only when one is chosen', async () => {
    const get = fakeFetch(200, { importId: TEST_RECORD_ID, counts: {}, items: [], total: 0, page: 2, pageSize: 25 })
    const source = createApiPortfolioImportPreviewSource(fakeApiClient(get))
    await source.preview(TEST_COMPANY_ID, TEST_RECORD_ID, { page: 2, pageSize: 25 })
    expect(urlOf(get, 0)).toEqual({ pathname: `/api/v1/portfolio-imports/${TEST_RECORD_ID}/preview`, query: { page: '2', pageSize: '25' } })
    await source.preview(TEST_COMPANY_ID, TEST_RECORD_ID, { result: 'conflict', page: 1, pageSize: 25 })
    expect(urlOf(get, 1).query).toEqual({ page: '1', pageSize: '25', result: 'conflict' })
  })
})
