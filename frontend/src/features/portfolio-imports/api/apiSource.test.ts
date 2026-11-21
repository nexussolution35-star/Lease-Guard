import { describe, expect, it, vi } from 'vitest'

import { fakeApiClient, fakeFetch, jsonResponse, notFoundFetch, requestAt, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiPortfolioImportSource, PortfolioUploadError } from './apiSource'

const BATCH = { id: TEST_RECORD_ID, companyId: TEST_COMPANY_ID, fileName: 'portfolio.csv', rowCount: 2 }
const TARGET = {
  importId: TEST_RECORD_ID,
  storagePath: `${TEST_COMPANY_ID}/${TEST_RECORD_ID}/portfolio.csv`,
  signedUrl: 'http://storage.test/upload',
  token: 't',
  contentType: 'text/csv',
  maxSizeBytes: 5242880,
}

describe('createApiPortfolioImportSource', () => {
  it('signs the upload, sends the file to storage with the content type the API names, then has the API read it', async () => {
    const api = vi.fn<typeof globalThis.fetch>(async (request) =>
      new URL((request as Request).url).pathname.endsWith('/upload-url') ? jsonResponse(200, TARGET) : jsonResponse(201, BATCH),
    )
    const storage = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))
    const file = new File(['Code\nMSQ\n'], 'portfolio.csv', { type: 'application/vnd.ms-excel' })

    const batch = await createApiPortfolioImportSource(fakeApiClient(api), storage).upload(TEST_COMPANY_ID, { file, scope: 'units', propertyId: TEST_RECORD_ID })
    expect(batch).toEqual(BATCH)
    expect(urlOf(api, 0).pathname).toBe('/api/v1/portfolio-imports/upload-url')
    expect(await requestAt(api, 0).json()).toEqual({ fileName: 'portfolio.csv', sizeBytes: file.size })
    expect(requestAt(api, 0).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
    expect(storage).toHaveBeenCalledWith(TARGET.signedUrl, { method: 'PUT', headers: { 'content-type': 'text/csv' }, body: file })
    expect(urlOf(api, 1).pathname).toBe('/api/v1/portfolio-imports')
    expect(await requestAt(api, 1).json()).toEqual({
      fileName: 'portfolio.csv',
      sizeBytes: file.size,
      scope: 'units',
      storagePath: TARGET.storagePath,
      propertyId: TEST_RECORD_ID,
    })
  })

  it('stops when storage refuses the file', async () => {
    const api = fakeFetch(200, TARGET)
    const storage = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 400 }))
    await expect(
      createApiPortfolioImportSource(fakeApiClient(api), storage).upload(TEST_COMPANY_ID, { file: new File(['x'], 'x.csv'), scope: 'properties' }),
    ).rejects.toBeInstanceOf(PortfolioUploadError)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('reads a batch, null when it is not in the company or the id is not a uuid', async () => {
    const get = fakeFetch(200, BATCH)
    await expect(createApiPortfolioImportSource(fakeApiClient(get)).get(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toEqual(BATCH)
    expect(urlOf(get).pathname).toBe(`/api/v1/portfolio-imports/${TEST_RECORD_ID}`)
    await expect(createApiPortfolioImportSource(fakeApiClient(notFoundFetch())).get(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toBeNull()
    const none = fakeFetch(200, BATCH)
    await expect(createApiPortfolioImportSource(fakeApiClient(none)).get(TEST_COMPANY_ID, 'not-a-uuid')).resolves.toBeNull()
    expect(none).not.toHaveBeenCalled()
  })

  it('has the API read a Google Sheet from its link', async () => {
    const post = fakeFetch(201, BATCH)
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=7'
    await expect(
      createApiPortfolioImportSource(fakeApiClient(post)).importGoogleSheet(TEST_COMPANY_ID, { url, scope: 'units', propertyId: TEST_RECORD_ID }),
    ).resolves.toEqual(BATCH)
    expect(urlOf(post).pathname).toBe('/api/v1/portfolio-imports/google-sheets')
    expect(requestAt(post).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(post).json()).toEqual({ url, scope: 'units', propertyId: TEST_RECORD_ID })
  })

  it('chooses another sheet', async () => {
    const post = fakeFetch(200, { ...BATCH, sheetName: 'Units' })
    await createApiPortfolioImportSource(fakeApiClient(post)).selectSheet(TEST_COMPANY_ID, TEST_RECORD_ID, 'Units')
    expect(urlOf(post).pathname).toBe(`/api/v1/portfolio-imports/${TEST_RECORD_ID}/sheet`)
    expect(await requestAt(post).json()).toEqual({ sheetName: 'Units' })
  })
})
