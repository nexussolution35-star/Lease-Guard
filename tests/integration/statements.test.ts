import { unwrap, type RegisterStatementDto, type StatementUploadUrlDto } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildStatementPdf, sha256Hex } from '../fixtures/pdf.ts'
import { anonSupabase, apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { countKeysWithPrefix } from '../fixtures/redis.ts'

interface IdRow {
  id: string
}

const api = () => apiAs('manager', 'a')

let propertyId: string
let pdf: Uint8Array<ArrayBuffer>
let fileName: string
/** Every upload target this file created, removed (row and object) in afterAll. */
const created: { statementId: string; bucket: string; storagePath: string }[] = []

beforeAll(async () => {
  const property = world().companies.a.properties[0]
  if (!property) throw new Error('The world has no property in company A')
  propertyId = property.id
  const { runId } = integration()
  // Unique content per run: a run that crashed before cleanup can never make this one a duplicate.
  pdf = buildStatementPdf(['LeaseGuard integration test statement', `Run ${runId}`, 'Monitoring record only - not a payment request'])
  fileName = `it-statement-${runId}.pdf`
})

afterAll(async () => {
  const db = serviceRole()
  for (const { statementId, bucket, storagePath } of created) {
    expectOk(await db.from('statements').delete().eq('id', statementId), `Delete statement ${statementId}`)
    expectOk(await db.storage.from(bucket).remove([storagePath]), `Remove object ${storagePath}`)
    const rows = check(
      await db.from('statements').select('id').eq('id', statementId).overrideTypes<IdRow[], { merge: false }>(),
      'Re-read statement',
    )
    const folder = storagePath.slice(0, storagePath.lastIndexOf('/'))
    const objects = check(await db.storage.from(bucket).list(folder), 'List statement folder')
    expect(rows, `statement ${statementId} removed`).toEqual([])
    expect(objects, `storage objects under ${folder} removed`).toEqual([])
  }
})

async function newUploadTarget(): Promise<StatementUploadUrlDto> {
  const target = await unwrap(
    api().POST('/api/v1/statements/upload-url', { body: { fileName, mimeType: 'application/pdf', sizeBytes: pdf.byteLength } }),
  )
  created.push({ statementId: target.statementId, bucket: target.bucket, storagePath: target.storagePath })
  return target
}

function registration(target: StatementUploadUrlDto): RegisterStatementDto {
  return {
    propertyId,
    storagePath: target.storagePath,
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: pdf.byteLength,
    sha256: sha256Hex(pdf),
    sourceSystem: 'MRI',
    statementDate: '2026-10-31',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    uploadBatchId: `integration-${integration().runId}`,
  }
}

describe('statement upload flow', () => {
  it('refuses upload URLs to a read_only member (403)', async () => {
    const error = await apiErrorOf(
      unwrap(
        apiAs('readOnly', 'a').POST('/api/v1/statements/upload-url', {
          body: { fileName, mimeType: 'application/pdf', sizeBytes: pdf.byteLength },
        }),
      ),
    )
    expect(error.status).toBe(403)
  })

  it('refuses to register a file that was never uploaded (422)', async () => {
    const target = await newUploadTarget()
    const error = await apiErrorOf(unwrap(api().POST('/api/v1/statements', { body: registration(target) })))
    expect(error.status).toBe(422)
  })

  it('signs an upload, accepts the PDF, registers it (201) and refuses the identical file again (409)', async () => {
    const target = await newUploadTarget()
    expect(target.bucket).toBe('statements')
    expect(target.storagePath.startsWith(`${world().companies.a.id}/${target.statementId}/`)).toBe(true)
    expect(target.maxSizeBytes).toBeGreaterThanOrEqual(pdf.byteLength)

    // Upload exactly as a browser would: anon key + the one-time token, never the service role.
    const upload = await anonSupabase()
      .storage.from(target.bucket)
      .uploadToSignedUrl(target.storagePath, target.token, new Blob([pdf], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
      })
    expect(upload.error).toBeNull()

    const body = registration(target)
    const registered = await api().POST('/api/v1/statements', { body })
    expect(registered.response.status).toBe(201)
    const result = registered.data
    if (!result) throw new Error(`registerStatement failed: ${JSON.stringify(registered.error)}`)
    expect(result.statement).toMatchObject({
      id: target.statementId,
      companyId: world().companies.a.id,
      propertyId,
      status: 'uploaded',
      uploadedByUserId: world().users.manager.id,
    })
    expect(result.duplicate).toBeNull()
    expect(typeof result.processingJobId).toBe('string')
    // The job went to this run's queue prefix (no worker consumes it; teardown deletes the keys).
    const { redisUrl, queuePrefix } = integration()
    expect(await countKeysWithPrefix(redisUrl, queuePrefix)).toBeGreaterThan(0)

    const again = await api().POST('/api/v1/statements', { body })
    expect(again.response.status).toBe(409)
    expect(again.error).toMatchObject({
      statusCode: 409,
      duplicate: { existingStatementId: target.statementId, reason: 'identical_file', confidence: 'exact' },
    })

    const listed = await unwrap(
      api().GET('/api/v1/statements', { params: { query: { search: fileName, pageSize: 10 } } }),
    )
    expect(listed.items.map((statement) => statement.id)).toEqual([target.statementId])
  })
})
