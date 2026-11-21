import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { LEASE_DOCUMENT_MAX_BYTES } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { fakeStorageDb, testApiEnv, type StorageCall } from '../../infrastructure/storage/storage.test-helpers'
import type { LeaseDocumentRow } from './lease-documents.mapper'
import type { RegisterLeaseDocumentBody } from './lease-documents.schemas'
import { LEASE_DOCUMENT_DOWNLOAD_SECONDS, LeaseDocumentsService, MAX_LEASE_DOCUMENTS } from './lease-documents.service'
import { COMPANY, leaseRow, VERIFIER } from './leases.test-helpers'

const DOCUMENT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const PATH = `${COMPANY}/${DOCUMENT}/MSQ-L012-signed.pdf`
const PDF = new TextEncoder().encode('%PDF-1.7\n% a signed lease\n%%EOF\n')
const PDF_SHA = createHash('sha256').update(PDF).digest('hex')

const documentRow: LeaseDocumentRow = {
  id: DOCUMENT,
  company_id: COMPANY,
  lease_id: leaseRow.id,
  document_type: 'signed_lease',
  title: 'Signed lease',
  file_name: 'MSQ-L012 signed.pdf',
  storage_path: PATH,
  mime_type: 'application/pdf',
  size_bytes: PDF.byteLength,
  sha256: PDF_SHA,
  uploaded_by_user_id: VERIFIER,
  uploaded_at: '2026-03-02T09:15:00+00:00',
  created_at: '2026-03-02T09:15:00+00:00',
  updated_at: '2026-03-02T09:15:00+00:00',
}

const body = (overrides: Partial<RegisterLeaseDocumentBody> = {}): RegisterLeaseDocumentBody => ({
  storagePath: PATH,
  fileName: 'MSQ-L012 signed.pdf',
  mimeType: 'application/pdf',
  sizeBytes: PDF.byteLength,
  documentType: 'signed_lease',
  title: 'Signed lease',
  ...overrides,
})

interface StorageOptions {
  /** Object metadata; null when the object is missing. */
  info?: { size?: number; contentType?: string } | null
  /** Stored bytes; null when the object is missing. */
  file?: Uint8Array | null
  signedUrl?: string | null
}

const notFound = { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }

function harness(respond: (query: RecordedQuery) => FakeResult, options: StorageOptions = {}) {
  const database = fakeDb(respond)
  const storage = fakeStorageDb((call: StorageCall) => {
    switch (call.method) {
      case 'createSignedUploadUrl':
        return { data: { signedUrl: `http://storage/sign/${String(call.args[0])}?token=t`, token: 't', path: call.args[0] }, error: null }
      case 'info': {
        const info = options.info === undefined ? { size: PDF.byteLength, contentType: 'application/pdf' } : options.info
        return info ? { data: info, error: null } : notFound
      }
      case 'download': {
        const file = options.file === undefined ? PDF : options.file
        return file ? { data: new Blob([new Uint8Array(file)], { type: 'application/pdf' }), error: null } : notFound
      }
      case 'createSignedUrl': {
        const url = options.signedUrl === undefined ? 'http://storage/object/sign/doc?token=d' : options.signedUrl
        return url ? { data: { signedUrl: url }, error: null } : notFound
      }
      default:
        throw new Error(`Unexpected storage call ${call.method}`)
    }
  })
  const db = Object.assign(database.client, { storage: storage.client.storage })
  const service = new LeaseDocumentsService(new StorageService(testApiEnv()))
  return { service, db, queries: database.queries, storageCalls: storage.calls }
}

const leaseFound = (query: RecordedQuery): FakeResult | null => (query.table === 'leases' ? { data: { id: leaseRow.id }, error: null } : null)

describe('LeaseDocumentsService.list', () => {
  it('lists the lease documents of the company, newest first, with type, file and uploader', async () => {
    const { service, db, queries } = harness((query) => leaseFound(query) ?? { data: [documentRow], error: null })

    const documents = await service.list(db, COMPANY, leaseRow.id)

    expect(documents).toEqual([
      {
        id: DOCUMENT,
        companyId: COMPANY,
        leaseId: leaseRow.id,
        documentType: 'signed_lease',
        title: 'Signed lease',
        file: { fileName: 'MSQ-L012 signed.pdf', storagePath: PATH, mimeType: 'application/pdf', sizeBytes: PDF.byteLength, sha256: PDF_SHA },
        uploadedByUserId: VERIFIER,
        uploadedAt: documentRow.uploaded_at,
        createdAt: documentRow.created_at,
        updatedAt: documentRow.updated_at,
      },
    ])
    const [lease, list] = queries
    expect(callsTo(lease!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', leaseRow.id],
    ])
    expect(list?.table).toBe('lease_documents')
    expect(callsTo(list!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['lease_id', leaseRow.id],
    ])
    expect(callsTo(list!, 'order')).toEqual([
      ['uploaded_at', { ascending: false }],
      ['id', { ascending: true }],
    ])
    expect(callsTo(list!, 'limit')).toEqual([[MAX_LEASE_DOCUMENTS]])
  })

  it('returns 404 for a lease that is not in the company, without listing documents', async () => {
    const { service, db, queries } = harness(() => ({ data: null, error: null }))
    await expect(service.list(db, COMPANY, leaseRow.id)).rejects.toBeInstanceOf(NotFoundException)
    expect(queries.map((query) => query.table)).toEqual(['leases'])
  })

  it('refuses a mime type the table does not allow rather than guessing', async () => {
    const { service, db } = harness((query) => leaseFound(query) ?? { data: [{ ...documentRow, mime_type: 'text/plain' }], error: null })
    await expect(service.list(db, COMPANY, leaseRow.id)).rejects.toThrow('Unexpected lease document mime_type')
  })
})

describe('LeaseDocumentsService.createUploadUrl', () => {
  it('signs <company>/<new document id>/<safe file name> in the lease-documents bucket, never overwriting', async () => {
    const { service, db, storageCalls } = harness((query) => leaseFound(query) ?? { data: null, error: null })

    const result = await service.createUploadUrl(db, COMPANY, leaseRow.id, { fileName: 'MSQ L012 signed (final).pdf', mimeType: 'application/pdf', sizeBytes: 1000 })

    expect(result.storagePath).toBe(`${COMPANY}/${result.documentId}/MSQ-L012-signed-final.pdf`)
    expect(result.maxSizeBytes).toBe(LEASE_DOCUMENT_MAX_BYTES)
    expect(storageCalls).toEqual([{ bucket: 'lease-documents', method: 'createSignedUploadUrl', args: [result.storagePath, { upsert: false }] }])
  })

  it('refuses a file over 20 MB with 413 before signing anything', async () => {
    const { service, db, queries, storageCalls } = harness((query) => leaseFound(query) ?? { data: null, error: null })
    await expect(
      service.createUploadUrl(db, COMPANY, leaseRow.id, { fileName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: LEASE_DOCUMENT_MAX_BYTES + 1 }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(queries).toHaveLength(0)
    expect(storageCalls).toHaveLength(0)
  })

  it('returns 404 for a lease not in the company, without signing', async () => {
    const { service, db, storageCalls } = harness(() => ({ data: null, error: null }))
    await expect(
      service.createUploadUrl(db, COMPANY, leaseRow.id, { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(storageCalls).toHaveLength(0)
  })
})

describe('LeaseDocumentsService.register', () => {
  const inserted = (query: RecordedQuery): FakeResult => leaseFound(query) ?? { data: documentRow, error: null }

  it('records the stored PDF on the lease with the id from its path and the SHA-256 of the stored bytes', async () => {
    const { service, db, queries, storageCalls } = harness(inserted)

    const document = await service.register(db, COMPANY, VERIFIER, leaseRow.id, body())

    expect(document.id).toBe(DOCUMENT)
    expect(storageCalls.map((call) => [call.bucket, call.method])).toEqual([
      ['lease-documents', 'info'],
      ['lease-documents', 'download'],
    ])
    const insert = queries.find((query) => query.table === 'lease_documents')!
    expect(callsTo(insert, 'insert')[0]?.[0]).toEqual({
      id: DOCUMENT,
      company_id: COMPANY,
      lease_id: leaseRow.id,
      document_type: 'signed_lease',
      title: 'Signed lease',
      file_name: 'MSQ-L012 signed.pdf',
      storage_path: PATH,
      mime_type: 'application/pdf',
      size_bytes: PDF.byteLength,
      sha256: PDF_SHA,
      uploaded_by_user_id: VERIFIER,
    })
  })

  it.each([
    ['another company', `5e5e5e5e-0000-4000-8000-000000000001/${DOCUMENT}/a.pdf`],
    ['not the path convention', `${COMPANY}/a.pdf`],
    ['a path with extra segments', `${COMPANY}/${DOCUMENT}/x/a.pdf`],
  ])('refuses a storage path of %s with 400', async (_label, storagePath) => {
    const { service, db, queries } = harness(inserted)
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body({ storagePath }))).rejects.toBeInstanceOf(BadRequestException)
    expect(queries).toHaveLength(0)
  })

  it('refuses with 422 when the file was not uploaded', async () => {
    const { service, db, queries } = harness(inserted, { info: null })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(queries.map((query) => query.table)).toEqual(['leases'])
  })

  it('refuses with 422 when the stored size differs from sizeBytes', async () => {
    const { service, db } = harness(inserted, { info: { size: 99, contentType: 'application/pdf' } })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toThrow('does not match sizeBytes')
  })

  it('refuses with 422 when the file is stored with another Content-Type', async () => {
    const { service, db } = harness(inserted, { info: { size: PDF.byteLength, contentType: 'image/png' } })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toThrow('not stored as a PDF')
  })

  it('refuses with 422 a file that does not start with the PDF header, whatever its name', async () => {
    const fake = new TextEncoder().encode('PK\u0003\u0004 not really a pdf')
    const { service, db, queries } = harness(inserted, { info: { size: fake.byteLength, contentType: 'application/pdf' }, file: fake })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body({ sizeBytes: fake.byteLength }))).rejects.toThrow('not a PDF')
    expect(queries.some((query) => query.table === 'lease_documents')).toBe(false)
  })

  it('refuses a file over 20 MB with 413 before reading storage', async () => {
    const { service, db, storageCalls } = harness(inserted)
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body({ sizeBytes: LEASE_DOCUMENT_MAX_BYTES + 1 }))).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    )
    expect(storageCalls).toHaveLength(0)
  })

  it('returns 404 for a lease not in the company, without reading storage', async () => {
    const { service, db, storageCalls } = harness(() => ({ data: null, error: null }))
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toBeInstanceOf(NotFoundException)
    expect(storageCalls).toHaveLength(0)
  })

  it('maps a unique violation (path already recorded) to 409', async () => {
    const { service, db } = harness((query) => leaseFound(query) ?? { data: null, error: { code: '23505', message: 'lease_documents_storage_path_key' } })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toBeInstanceOf(ConflictException)
  })

  it('passes a database rule refusal (P0001) on as 422 with its message', async () => {
    const { service, db } = harness((query) => leaseFound(query) ?? { data: null, error: { code: 'P0001', message: 'Upload the file before recording the document' } })
    await expect(service.register(db, COMPANY, VERIFIER, leaseRow.id, body())).rejects.toThrow('Upload the file before recording the document')
  })
})

describe('LeaseDocumentsService.downloadUrl', () => {
  it('signs a five-minute link to the document of this lease and company', async () => {
    const { service, db, queries, storageCalls } = harness(() => ({ data: { storage_path: PATH }, error: null }))

    const link = await service.downloadUrl(db, COMPANY, leaseRow.id, DOCUMENT)

    expect(link).toEqual({ url: 'http://storage/object/sign/doc?token=d', expiresInSeconds: LEASE_DOCUMENT_DOWNLOAD_SECONDS })
    expect(LEASE_DOCUMENT_DOWNLOAD_SECONDS).toBe(300)
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['lease_id', leaseRow.id],
      ['id', DOCUMENT],
    ])
    expect(storageCalls).toEqual([{ bucket: 'lease-documents', method: 'createSignedUrl', args: [PATH, 300] }])
  })

  it('returns 404 for a document not on this lease of the company', async () => {
    const { service, db, storageCalls } = harness(() => ({ data: null, error: null }))
    await expect(service.downloadUrl(db, COMPANY, leaseRow.id, DOCUMENT)).rejects.toBeInstanceOf(NotFoundException)
    expect(storageCalls).toHaveLength(0)
  })

  it('returns 404 when the file is missing from storage', async () => {
    const { service, db } = harness(() => ({ data: { storage_path: PATH }, error: null }), { signedUrl: null })
    await expect(service.downloadUrl(db, COMPANY, leaseRow.id, DOCUMENT)).rejects.toThrow('The document file was not found')
  })
})
