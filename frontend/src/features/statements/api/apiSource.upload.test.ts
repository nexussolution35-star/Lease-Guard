import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it, vi } from 'vitest'

import { fakeApiClient, jsonResponse, requestAt, sampleRecord, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiStatementSource, StatementUploadError } from './apiSource'
import type { StatementUploadInput } from './source'

const statement = sampleRecord('statements')
const STATEMENT_ID = TEST_RECORD_ID
const STORAGE_PATH = `${TEST_COMPANY_ID}/${STATEMENT_ID}/msq-oct.pdf`
const SHA = 'a'.repeat(64)
const TARGET = { statementId: STATEMENT_ID, bucket: 'statements', storagePath: STORAGE_PATH, signedUrl: 'http://storage/upload?token=t', token: 't', maxSizeBytes: 20971520 }

function input(): StatementUploadInput {
  return {
    file: new File(['%PDF-1.7'], 'msq-oct.pdf', { type: 'application/pdf' }),
    sha256: SHA,
    propertyId: TEST_FILTER_ID,
    sourceSystem: 'MRI',
    uploadBatchId: 'batch-1',
  }
}

/** The API: upload-url answers the target, register answers `register`. */
function api(register: { status: number; body: unknown }) {
  return vi.fn<typeof globalThis.fetch>(async (request) => {
    const url = new URL((request as Request).url)
    if (url.pathname.endsWith('/upload-url')) return jsonResponse(200, TARGET)
    return jsonResponse(register.status, register.body)
  })
}

const storageOk = () => vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))

describe('createApiStatementSource upload', () => {
  it('signs the upload, sends the PDF to storage, then registers it in the batch with its digest', async () => {
    const fetch = api({ status: 201, body: { statement, duplicate: null, processingJobId: 'job-1' } })
    const storage = storageOk()
    const phases: string[] = []

    const result = await createApiStatementSource(fakeApiClient(fetch), storage).upload(TEST_COMPANY_ID, input(), (phase) => phases.push(phase))

    expect(result).toEqual({ outcome: 'registered', statement, processingQueued: true, likelyDuplicate: null })
    expect(phases).toEqual(['uploading', 'registering'])
    expect(urlOf(fetch, 0).pathname).toBe('/api/v1/statements/upload-url')
    expect(requestAt(fetch, 0).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(fetch, 0).json()).toEqual({ fileName: 'msq-oct.pdf', mimeType: 'application/pdf', sizeBytes: 8 })
    expect(storage).toHaveBeenCalledWith(TARGET.signedUrl, expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'application/pdf' } }))
    expect(urlOf(fetch, 1).pathname).toBe('/api/v1/statements')
    expect(requestAt(fetch, 1).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(fetch, 1).json()).toEqual({
      fileName: 'msq-oct.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
      storagePath: STORAGE_PATH,
      sha256: SHA,
      propertyId: TEST_FILTER_ID,
      sourceSystem: 'MRI',
      uploadBatchId: 'batch-1',
    })
  })

  it('reports a likely duplicate and a statement that could not be queued', async () => {
    const duplicate = { existingStatementId: TEST_FILTER_ID, reason: 'same_tenant_period_and_number', confidence: 'likely', description: 'Same tenant and period' }
    const fetch = api({ status: 201, body: { statement, duplicate, processingJobId: null } })
    const result = await createApiStatementSource(fakeApiClient(fetch), storageOk()).upload(TEST_COMPANY_ID, input())
    expect(result).toEqual({ outcome: 'registered', statement, processingQueued: false, likelyDuplicate: duplicate })
  })

  it('turns the 409 for an identical file into a link to the statement on record', async () => {
    const duplicate = { existingStatementId: TEST_FILTER_ID, reason: 'identical_file', confidence: 'exact', description: 'Identical file already uploaded' }
    const fetch = api({ status: 409, body: { statusCode: 409, error: 'Conflict', message: 'Identical file already uploaded', requestId: null, duplicate } })
    const result = await createApiStatementSource(fakeApiClient(fetch), storageOk()).upload(TEST_COMPANY_ID, input())
    expect(result).toEqual({ outcome: 'identical', existingStatementId: TEST_FILTER_ID, message: 'Identical file already uploaded' })
  })

  it('rethrows any other refusal, including a plain 409', async () => {
    const conflict = api({ status: 409, body: { statusCode: 409, error: 'Conflict', message: 'request a new upload URL', requestId: null } })
    await expect(createApiStatementSource(fakeApiClient(conflict), storageOk()).upload(TEST_COMPANY_ID, input())).rejects.toBeInstanceOf(ApiError)
    const mismatch = api({ status: 422, body: { statusCode: 422, error: 'Unprocessable Entity', message: 'The SHA-256 does not match', requestId: null } })
    await expect(createApiStatementSource(fakeApiClient(mismatch), storageOk()).upload(TEST_COMPANY_ID, input())).rejects.toThrow('The SHA-256 does not match')
  })

  it('stops without registering when storage refuses the file', async () => {
    const fetch = api({ status: 201, body: {} })
    const refused = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 400 }))
    await expect(createApiStatementSource(fakeApiClient(fetch), refused).upload(TEST_COMPANY_ID, input())).rejects.toBeInstanceOf(StatementUploadError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends the upload batch filter on the list', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }))
    await createApiStatementSource(fakeApiClient(fetch)).list(TEST_COMPANY_ID, { page: 1, pageSize: 25, uploadBatchId: 'batch-1' })
    expect(urlOf(fetch).query).toEqual({ page: '1', pageSize: '25', uploadBatchId: 'batch-1' })
  })
})
