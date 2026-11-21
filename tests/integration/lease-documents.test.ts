import { unwrap, type LeaseDocumentUploadUrlDto, type RegisterLeaseDocumentDto } from '@leaseguard/api-client'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { buildStatementPdf, sha256Hex } from '../fixtures/pdf.ts'
import { anonSupabase, apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { auditCount } from './support/local-db.ts'

const BUCKET = 'lease-documents'
const api = () => apiAs('manager', 'a')

let lease: WorldLease
let pdf: Uint8Array<ArrayBuffer>
let fileName: string
/** Every upload target this file created, removed (row and object) in afterAll. */
const created: { documentId: string; storagePath: string }[] = []

beforeAll(() => {
  const first = world().companies.a.leases[0]
  if (!first) throw new Error('The world has no lease in company A')
  lease = first
  const { runId } = integration()
  pdf = buildStatementPdf(['LeaseGuard integration test signed lease', `Run ${runId}`])
  fileName = `it-signed-lease-${runId}.pdf`
})

afterAll(async () => {
  const db = serviceRole()
  for (const { documentId, storagePath } of created) {
    expectOk(await db.from('lease_documents').delete().eq('id', documentId), `Delete lease document ${documentId}`)
    expectOk(await db.storage.from(BUCKET).remove([storagePath]), `Remove object ${storagePath}`)
  }
})

async function newUploadTarget(sizeBytes = pdf.byteLength): Promise<LeaseDocumentUploadUrlDto> {
  const target = await unwrap(
    api().POST('/api/v1/leases/{leaseId}/documents/upload-url', {
      params: { path: { leaseId: lease.id } },
      body: { fileName, mimeType: 'application/pdf', sizeBytes },
    }),
  )
  created.push({ documentId: target.documentId, storagePath: target.storagePath })
  return target
}

/** Uploads exactly as a browser does: anon key + the one-time token, never the service role. */
async function uploadTo(target: LeaseDocumentUploadUrlDto, bytes: Uint8Array<ArrayBuffer>, contentType = 'application/pdf') {
  return anonSupabase().storage.from(BUCKET).uploadToSignedUrl(target.storagePath, target.token, new Blob([bytes], { type: contentType }), { contentType })
}

function registration(target: LeaseDocumentUploadUrlDto, sizeBytes = pdf.byteLength): RegisterLeaseDocumentDto {
  return { storagePath: target.storagePath, fileName, mimeType: 'application/pdf', sizeBytes, documentType: 'signed_lease', title: 'Signed lease' }
}

describe('lease document upload (POST /leases/{id}/documents…)', () => {
  it('refuses upload URLs to a read_only member (403)', async () => {
    const error = await apiErrorOf(
      unwrap(
        apiAs('readOnly', 'a').POST('/api/v1/leases/{leaseId}/documents/upload-url', {
          params: { path: { leaseId: lease.id } },
          body: { fileName, mimeType: 'application/pdf', sizeBytes: pdf.byteLength },
        }),
      ),
    )
    expect(error.status).toBe(403)
  })

  it('refuses a file over 20 MB (413) and anything but a PDF (400)', async () => {
    const params = { path: { leaseId: lease.id } }
    const large = await apiErrorOf(
      unwrap(api().POST('/api/v1/leases/{leaseId}/documents/upload-url', { params, body: { fileName, mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 + 1 } })),
    )
    expect(large.status).toBe(413)
    const image = await apiErrorOf(
      unwrap(
        api().POST('/api/v1/leases/{leaseId}/documents/upload-url', {
          params,
          body: { fileName: 'scan.png', mimeType: 'image/png' as 'application/pdf', sizeBytes: 100 },
        }),
      ),
    )
    expect(image.status).toBe(400)
  })

  it('answers 404 for a lease of another company', async () => {
    const other = world().companies.b.leases[0]
    if (!other) throw new Error('The world has no lease in company B')
    const error = await apiErrorOf(
      unwrap(
        api().POST('/api/v1/leases/{leaseId}/documents/upload-url', {
          params: { path: { leaseId: other.id } },
          body: { fileName, mimeType: 'application/pdf', sizeBytes: pdf.byteLength },
        }),
      ),
    )
    expect(error.status).toBe(404)
  })

  it('refuses to record a file that was never uploaded (422)', async () => {
    const target = await newUploadTarget()
    const error = await apiErrorOf(unwrap(api().POST('/api/v1/leases/{leaseId}/documents', { params: { path: { leaseId: lease.id } }, body: registration(target) })))
    expect(error.status).toBe(422)
  })

  it('refuses a file that is not really a PDF, whatever its name (422)', async () => {
    const fake = new TextEncoder().encode('PK\u0003\u0004 a word document pretending to be a PDF') as Uint8Array<ArrayBuffer>
    const target = await newUploadTarget(fake.byteLength)
    expect((await uploadTo(target, fake)).error).toBeNull()
    const error = await apiErrorOf(
      unwrap(api().POST('/api/v1/leases/{leaseId}/documents', { params: { path: { leaseId: lease.id } }, body: registration(target, fake.byteLength) })),
    )
    expect(error.status).toBe(422)
  })

  it('stores the PDF under the company, records it with type and uploader, audits it, lists it and links to it', async () => {
    const companyId = world().companies.a.id
    const target = await newUploadTarget()
    expect(target.storagePath.startsWith(`${companyId}/${target.documentId}/`)).toBe(true)
    expect(target.maxSizeBytes).toBe(20 * 1024 * 1024)
    expect((await uploadTo(target, pdf)).error).toBeNull()

    const params = { path: { leaseId: lease.id } }
    const recorded = await api().POST('/api/v1/leases/{leaseId}/documents', { params, body: registration(target) })
    expect(recorded.response.status).toBe(201)
    const document = recorded.data
    if (!document) throw new Error(`registerLeaseDocument failed: ${JSON.stringify(recorded.error)}`)
    expect(document).toMatchObject({
      id: target.documentId,
      companyId,
      leaseId: lease.id,
      documentType: 'signed_lease',
      title: 'Signed lease',
      uploadedByUserId: world().users.manager.id,
      file: { fileName, storagePath: target.storagePath, mimeType: 'application/pdf', sizeBytes: pdf.byteLength, sha256: sha256Hex(pdf) },
    })
    expect(await auditCount(document.id)).toBe(1)

    const again = await api().POST('/api/v1/leases/{leaseId}/documents', { params, body: registration(target) })
    expect(again.response.status).toBe(409)

    const listed = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/leases/{leaseId}/documents', { params }))
    expect(listed.find((item) => item.id === document.id)).toMatchObject({ documentType: 'signed_lease', uploadedByUserId: world().users.manager.id })

    const link = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/leases/{leaseId}/documents/{documentId}/download-url', {
        params: { path: { leaseId: lease.id, documentId: document.id } },
      }),
    )
    expect(link.expiresInSeconds).toBe(300)
    const downloaded = await fetch(link.url)
    expect(downloaded.status).toBe(200)
    expect(createHash('sha256').update(new Uint8Array(await downloaded.arrayBuffer())).digest('hex')).toBe(sha256Hex(pdf))

    // Another company cannot read it, not even with the document id.
    const hidden = await apiErrorOf(
      unwrap(
        apiAs('manager', 'b').GET('/api/v1/leases/{leaseId}/documents/{documentId}/download-url', {
          params: { path: { leaseId: lease.id, documentId: document.id } },
        }),
      ),
    )
    expect(hidden.status).toBe(404)
    const rows = check(await serviceRole().from('lease_documents').select('id').eq('id', document.id), 'Re-read lease document')
    expect(rows).toHaveLength(1)
  })
})
