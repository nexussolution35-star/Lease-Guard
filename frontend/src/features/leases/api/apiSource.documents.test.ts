import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it, vi } from 'vitest'

import { fakeApiClient, fakeFetch, jsonResponse, notFoundFetch, requestAt, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiLeaseSource, LeaseDocumentUploadError } from './apiSource'

const LEASE_ID = TEST_RECORD_ID
const DOCUMENT_ID = TEST_FILTER_ID
const STORAGE_PATH = `${TEST_COMPANY_ID}/${DOCUMENT_ID}/signed.pdf`

describe('createApiLeaseSource documents', () => {
  it('signs the upload, sends the PDF to storage, then records it on the lease with its type and title', async () => {
    const api = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL((input as Request).url)
      if (url.pathname.endsWith('/upload-url')) {
        return jsonResponse(200, { documentId: DOCUMENT_ID, storagePath: STORAGE_PATH, signedUrl: 'http://storage/upload?token=t', token: 't', maxSizeBytes: 20971520 })
      }
      return jsonResponse(201, { id: DOCUMENT_ID, leaseId: LEASE_ID, documentType: 'signed_lease', title: 'Signed lease' })
    })
    const storage = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))
    const file = new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' })

    const document = await createApiLeaseSource(fakeApiClient(api), storage).uploadDocument(TEST_COMPANY_ID, LEASE_ID, {
      file,
      documentType: 'signed_lease',
      title: 'Signed lease',
    })

    expect(document.id).toBe(DOCUMENT_ID)
    expect(urlOf(api, 0).pathname).toBe(`/api/v1/leases/${LEASE_ID}/documents/upload-url`)
    expect(requestAt(api, 0).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(api, 0).json()).toEqual({ fileName: 'signed.pdf', mimeType: 'application/pdf', sizeBytes: file.size })
    expect(storage).toHaveBeenCalledWith(
      'http://storage/upload?token=t',
      expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: file }),
    )
    expect(urlOf(api, 1).pathname).toBe(`/api/v1/leases/${LEASE_ID}/documents`)
    expect(await requestAt(api, 1).json()).toEqual({
      fileName: 'signed.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      storagePath: STORAGE_PATH,
      documentType: 'signed_lease',
      title: 'Signed lease',
    })
  })

  it('stops without recording when storage refuses the file', async () => {
    const api = fakeFetch(200, { documentId: DOCUMENT_ID, storagePath: STORAGE_PATH, signedUrl: 'http://storage/upload', token: 't', maxSizeBytes: 10 })
    const refused = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 400 }))
    const file = new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' })
    await expect(
      createApiLeaseSource(fakeApiClient(api), refused).uploadDocument(TEST_COMPANY_ID, LEASE_ID, { file, documentType: 'fica', title: 'FICA' }),
    ).rejects.toBeInstanceOf(LeaseDocumentUploadError)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('rethrows an API refusal of the upload (e.g. 413 over the size limit) without touching storage', async () => {
    const api = fakeFetch(413, { statusCode: 413, error: 'Payload Too Large', message: 'The file is larger than the 20 MB limit', requestId: null })
    const storage = vi.fn<typeof globalThis.fetch>()
    const file = new File(['%PDF-1.7'], 'big.pdf', { type: 'application/pdf' })
    await expect(
      createApiLeaseSource(fakeApiClient(api), storage).uploadDocument(TEST_COMPANY_ID, LEASE_ID, { file, documentType: 'other', title: 'Big' }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(storage).not.toHaveBeenCalled()
  })

  it('asks for a short-lived download link to one document of the lease', async () => {
    const api = fakeFetch(200, { url: 'http://storage/object/sign/doc?token=d', expiresInSeconds: 300 })
    const url = await createApiLeaseSource(fakeApiClient(api)).documentDownloadUrl(TEST_COMPANY_ID, LEASE_ID, DOCUMENT_ID)
    expect(url).toBe('http://storage/object/sign/doc?token=d')
    expect(urlOf(api).pathname).toBe(`/api/v1/leases/${LEASE_ID}/documents/${DOCUMENT_ID}/download-url`)
    expect(requestAt(api).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    await expect(createApiLeaseSource(fakeApiClient(notFoundFetch())).documentDownloadUrl(TEST_COMPANY_ID, LEASE_ID, DOCUMENT_ID)).rejects.toBeInstanceOf(ApiError)
  })
})
