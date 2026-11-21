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
    // A list row names its property; no tenant or unit until the statement is matched.
    expect(listed.items[0]).toMatchObject({ propertyName: world().companies.a.properties[0]?.name })
    expect(listed.items[0]).not.toHaveProperty('tenantName')
    expect(listed.items[0]).not.toHaveProperty('closingBalance')
  })
})

describe('statement facts from the document', () => {
  it('registers a statement without a typed date, period or number (201): they come from the document', async () => {
    // Different bytes from the other uploads in this file, so it is not their duplicate.
    const own = buildStatementPdf(['LeaseGuard integration test statement', `Run ${integration().runId}`, 'Facts read from the document'])
    const target = await unwrap(
      api().POST('/api/v1/statements/upload-url', { body: { fileName, mimeType: 'application/pdf', sizeBytes: own.byteLength } }),
    )
    created.push({ statementId: target.statementId, bucket: target.bucket, storagePath: target.storagePath })
    const upload = await anonSupabase()
      .storage.from(target.bucket)
      .uploadToSignedUrl(target.storagePath, target.token, new Blob([own], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    expect(upload.error).toBeNull()

    const { statementDate: _date, periodStart: _start, periodEnd: _end, ...untyped } = registration(target)
    const registered = await api().POST('/api/v1/statements', { body: { ...untyped, sizeBytes: own.byteLength, sha256: sha256Hex(own) } })
    expect(registered.response.status).toBe(201)
    const statement = registered.data?.statement
    expect(statement).toMatchObject({ id: target.statementId, status: 'uploaded' })
    for (const absent of ['statementDate', 'periodStart', 'periodEnd', 'statementNumber']) expect(statement).not.toHaveProperty(absent)

    // Half a period is refused rather than guessed.
    const halfPeriod = await api().POST('/api/v1/statements', { body: { ...untyped, periodStart: '2026-10-01' } })
    expect(halfPeriod.response.status).toBe(400)
  })
})

describe('retrying a statement whose processing failed', () => {
  it('puts it back to uploaded and queues it again for writers, audited; read-only members are refused', async () => {
    // Distinct content: the upload above must not make this one a duplicate.
    const { runId } = integration()
    const failedPdf = buildStatementPdf(['LeaseGuard integration test statement', `Retry ${runId}`])
    const target = await unwrap(
      api().POST('/api/v1/statements/upload-url', { body: { fileName, mimeType: 'application/pdf', sizeBytes: failedPdf.byteLength } }),
    )
    created.push({ statementId: target.statementId, bucket: target.bucket, storagePath: target.storagePath })
    const upload = await anonSupabase()
      .storage.from(target.bucket)
      .uploadToSignedUrl(target.storagePath, target.token, new Blob([failedPdf], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    expect(upload.error).toBeNull()
    await unwrap(
      api().POST('/api/v1/statements', {
        body: { ...registration(target), sizeBytes: failedPdf.byteLength, sha256: sha256Hex(failedPdf) },
      }),
    )

    // What the worker leaves behind when extraction gives up.
    const reason = 'The PDF could not be read; enter the figures manually'
    expectOk(
      await serviceRole().from('statements').update({ status: 'review_required', processing_error: reason }).eq('id', target.statementId),
      'Mark statement failed',
    )
    const listed = await unwrap(api().GET('/api/v1/statements', { params: { query: { status: 'review_required', search: fileName } } }))
    expect(listed.items.find((statement) => statement.id === target.statementId)).toMatchObject({ processingError: reason })

    const refused = await apiErrorOf(
      unwrap(apiAs('readOnly', 'a').POST('/api/v1/statements/{statementId}/process', { params: { path: { statementId: target.statementId } } })),
    )
    expect(refused.status).toBe(403)

    const retried = await api().POST('/api/v1/statements/{statementId}/process', { params: { path: { statementId: target.statementId } } })
    expect(retried.response.status).toBe(202)
    expect(retried.data).toMatchObject({ statementId: target.statementId, status: 'uploaded' })

    const row = check(
      await serviceRole().from('statements').select('status, processing_error').eq('id', target.statementId).single(),
      'Re-read statement',
    )
    expect(row).toEqual({ status: 'uploaded', processing_error: null })
    const audit = check(
      await serviceRole().from('audit_logs').select('actor_user_id, changes').eq('entity_id', target.statementId).order('occurred_at'),
      'Read audit',
    )
    expect(audit.at(-1)).toMatchObject({
      actor_user_id: world().users.manager.id,
      changes: expect.arrayContaining([{ field: 'status', before: 'review_required', after: 'uploaded' }]),
    })

    // Once it is no longer failed it is an ordinary uploaded statement; a final statement is refused.
    expectOk(await serviceRole().from('statements').update({ status: 'rejected' }).eq('id', target.statementId), 'Reject statement')
    const final = await apiErrorOf(
      unwrap(api().POST('/api/v1/statements/{statementId}/process', { params: { path: { statementId: target.statementId } } })),
    )
    expect(final.status).toBe(409)
  })
})

describe('uploading statements as one batch', () => {
  /** Signs, uploads (as a browser would) and registers one PDF in the batch; returns the target and the API's answer. */
  async function uploadInBatch(bytes: Uint8Array<ArrayBuffer>, uploadBatchId: string) {
    const target = await unwrap(
      api().POST('/api/v1/statements/upload-url', { body: { fileName, mimeType: 'application/pdf', sizeBytes: bytes.byteLength } }),
    )
    created.push({ statementId: target.statementId, bucket: target.bucket, storagePath: target.storagePath })
    const upload = await anonSupabase()
      .storage.from(target.bucket)
      .uploadToSignedUrl(target.storagePath, target.token, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    expect(upload.error).toBeNull()
    const answer = await api().POST('/api/v1/statements', {
      body: { propertyId, storagePath: target.storagePath, fileName, mimeType: 'application/pdf', sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes), sourceSystem: 'Sage', uploadBatchId },
    })
    return { target, answer }
  }

  it('registers each file under the batch, audits each upload, refuses and drops an identical copy, and lists the batch', async () => {
    const uploadBatchId = `batch-${integration().runId}`
    const first = buildStatementPdf(['LeaseGuard integration test statement', `Run ${integration().runId}`, 'Batch file one'])
    const second = buildStatementPdf(['LeaseGuard integration test statement', `Run ${integration().runId}`, 'Batch file two'])

    const one = await uploadInBatch(first, uploadBatchId)
    const two = await uploadInBatch(second, uploadBatchId)
    expect(one.answer.response.status).toBe(201)
    expect(two.answer.response.status).toBe(201)
    expect(one.answer.data?.statement).toMatchObject({ status: 'uploaded', uploadBatchId, uploadedByUserId: world().users.manager.id })

    // The same file again in the batch: refused with the statement on record, and the copy is not kept.
    const repeat = await uploadInBatch(first, uploadBatchId)
    expect(repeat.answer.response.status).toBe(409)
    expect(repeat.answer.error).toMatchObject({ duplicate: { existingStatementId: one.target.statementId, confidence: 'exact' } })
    const folder = repeat.target.storagePath.slice(0, repeat.target.storagePath.lastIndexOf('/'))
    expect(check(await serviceRole().storage.from('statements').list(folder), 'List repeat folder')).toEqual([])

    const listed = await unwrap(api().GET('/api/v1/statements', { params: { query: { uploadBatchId, pageSize: 10 } } }))
    expect(listed.items.map((statement) => statement.id).sort()).toEqual([one.target.statementId, two.target.statementId].sort())

    const audit = check(
      await serviceRole()
        .from('audit_logs')
        .select('entity_id, action, actor_user_id')
        .eq('entity_type', 'statement')
        .eq('action', 'upload')
        .in('entity_id', [one.target.statementId, two.target.statementId, repeat.target.statementId])
        .overrideTypes<{ entity_id: string; action: string; actor_user_id: string }[], { merge: false }>(),
      'Read upload audit',
    )
    expect(audit.map((entry) => entry.entity_id).sort()).toEqual([one.target.statementId, two.target.statementId].sort())
    expect(new Set(audit.map((entry) => entry.actor_user_id))).toEqual(new Set([world().users.manager.id]))
  })
})
