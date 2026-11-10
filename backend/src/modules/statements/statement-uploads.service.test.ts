import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { CompanyAccessGuard } from '../../common/guards/company-access.guard'
import { fakeClients, httpContext } from '../../common/guards/guards.test-helpers'
import type { LeaseGuardRequest } from '../../common/request-context'
import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { EnqueueOutcome, EnqueueResult, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { jobIdFor, type JobPayloads } from '../../infrastructure/queues/queue-registry'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { fakeStorageDb, testApiEnv, type StorageCall } from '../../infrastructure/storage/storage.test-helpers'
import { DuplicateStatementException } from './duplicate-statement.exception'
import { StatementUploadsService } from './statement-uploads.service'
import { registerStatementBodySchema, type RegisterStatementBody } from './statements.schemas'
import { COMPANY, PROPERTY, SHA, STATEMENT, statementRow, TENANT, USER } from './statements.test-helpers'

const PATH = `${COMPANY}/${STATEMENT}/MSQ-Shop12-2026-10.pdf`
const EXISTING = '6f1d2c1e-0000-4000-8000-0000000000ff'
/** The uploaded file's bytes, and their real SHA-256, which the server computes from the stored object. */
const FILE = new Uint8Array(52_000).fill(7)
const FILE_SHA = createHash('sha256').update(FILE).digest('hex')

function body(overrides: Record<string, unknown> = {}): RegisterStatementBody {
  return registerStatementBodySchema.parse({
    propertyId: PROPERTY,
    storagePath: PATH,
    fileName: 'MSQ-Shop12-2026-10.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 52_000,
    sha256: FILE_SHA.toUpperCase(),
    sourceSystem: 'MRI',
    statementDate: '2026-10-31',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    tenantId: TENANT,
    ...overrides,
  })
}

interface Harness {
  service: StatementUploadsService
  db: DbClient
  queries: RecordedQuery[]
  storageCalls: StorageCall[]
  enqueue: ReturnType<typeof vi.fn>
  enqueueOrRetry: ReturnType<typeof vi.fn>
}

function harness(
  respond: (query: RecordedQuery, index: number) => FakeResult,
  options: { objectSize?: number | null; file?: Uint8Array | null; enqueueFails?: boolean; retryOutcome?: EnqueueOutcome } = {},
): Harness {
  let index = 0
  const database = fakeDb((query) => respond(query, index++))
  const storage = fakeStorageDb((call) => {
    if (call.method === 'createSignedUploadUrl') {
      return { data: { signedUrl: `http://storage/sign/${String(call.args[0])}?token=t`, token: 't', path: call.args[0] }, error: null }
    }
    const notFound = { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
    if (call.method === 'download') {
      const file = options.file === undefined ? FILE : options.file
      return file ? { data: new Blob([new Uint8Array(file)], { type: 'application/pdf' }), error: null } : notFound
    }
    if (options.objectSize === null) return notFound
    return { data: { size: options.objectSize ?? 52_000 }, error: null }
  })
  const db = Object.assign(database.client, { storage: storage.client.storage })
  const enqueue = vi.fn(async <Q extends keyof JobPayloads>(queue: Q, payload: JobPayloads[Q]) => {
    if (options.enqueueFails) throw new ServiceUnavailableException('Background processing is not available')
    return jobIdFor(queue, payload)
  })
  const enqueueOrRetry = vi.fn(async <Q extends keyof JobPayloads>(queue: Q, payload: JobPayloads[Q]): Promise<EnqueueResult> => {
    if (options.enqueueFails) throw new ServiceUnavailableException('Background processing is not available')
    return { jobId: jobIdFor(queue, payload), outcome: options.retryOutcome ?? 'already_queued' }
  })
  const service = new StatementUploadsService(new StorageService(testApiEnv()), { enqueue, enqueueOrRetry } as unknown as QueueProducer)
  return { service, db, queries: database.queries, storageCalls: storage.calls, enqueue, enqueueOrRetry }
}

describe('StatementUploadsService.createUploadUrl', () => {
  it('signs <company>/<new statement id>/<safe file name> in the statements bucket', async () => {
    const { service, db, storageCalls } = harness(() => ({ data: null, error: null }))

    const result = await service.createUploadUrl(db, COMPANY, { fileName: 'Shop 12 (Oct).pdf', mimeType: 'application/pdf', sizeBytes: 1000 })

    expect(result.storagePath).toBe(`${COMPANY}/${result.statementId}/Shop-12-Oct.pdf`)
    expect(result).toMatchObject({ bucket: 'statements', token: 't', maxSizeBytes: 20 * 1024 * 1024 })
    expect(storageCalls).toEqual([
      { bucket: 'statements', method: 'createSignedUploadUrl', args: [result.storagePath, { upsert: false }] },
    ])
  })

  it('signs a lowercase path when the X-Company-Id header was sent in uppercase', async () => {
    const { factory } = fakeClients({ membership: { data: { role: 'property_manager' }, error: null } })
    const request: Partial<LeaseGuardRequest> = {
      user: { userId: USER, email: 'pm@nexus.co.za', accessToken: 'user.jwt' },
      headers: { 'x-company-id': COMPANY.toUpperCase() },
    }
    await new CompanyAccessGuard(factory).canActivate(httpContext(request))
    const { service, db } = harness(() => ({ data: null, error: null }))

    const result = await service.createUploadUrl(db, request.company!.companyId, { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000 })

    expect(result.storagePath).toBe(`${COMPANY}/${result.statementId}/a.pdf`)
  })

  it('refuses files over DOCUMENT_PROCESSING_MAX_FILE_MB before signing', async () => {
    const { service, db, storageCalls } = harness(() => ({ data: null, error: null }))
    await expect(
      service.createUploadUrl(db, COMPANY, { fileName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 + 1 }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(storageCalls).toHaveLength(0)
  })
})

describe('StatementUploadsService.register', () => {
  it('inserts an uploaded statement with the id from the storage path and queues processing', async () => {
    const { service, db, queries, enqueue } = harness((query) =>
      callsTo(query, 'insert').length ? { data: statementRow(), error: null } : { data: [], error: null },
    )

    const result = await service.register(db, COMPANY, USER, body())

    expect(result.duplicate).toBeNull()
    expect(result.processingJobId).toBe(`statement-processing.${COMPANY}.${STATEMENT}`)
    expect(enqueue).toHaveBeenCalledWith('statement-processing', { companyId: COMPANY, statementId: STATEMENT })

    const [candidates, insert] = queries
    expect(callsTo(candidates!, 'eq')).toEqual([['company_id', COMPANY]])
    expect(callsTo(candidates!, 'not')).toEqual([['status', 'in', '(duplicate,rejected)']])
    expect(callsTo(candidates!, 'or')).toEqual([
      [`file_sha256.eq.${FILE_SHA},and(tenant_id.eq.${TENANT},period_start.eq.2026-10-01,period_end.eq.2026-10-31)`],
    ])
    expect(callsTo(insert!, 'insert')[0]?.[0]).toMatchObject({
      id: STATEMENT,
      company_id: COMPANY,
      property_id: PROPERTY,
      file_sha256: FILE_SHA,
      status: 'uploaded',
      uploaded_by_user_id: USER,
      unit_id: null,
      statement_number: null,
    })
  })

  it('refuses an identical file with 409 naming the statement on record, without inserting', async () => {
    const { service, db, queries, enqueue } = harness(() => ({ data: [statementRow({ id: EXISTING, file_sha256: FILE_SHA })], error: null }))

    const error = await service.register(db, COMPANY, USER, body()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DuplicateStatementException)
    expect((error as DuplicateStatementException).getStatus()).toBe(409)
    expect((error as DuplicateStatementException).match).toMatchObject({ existingStatementId: EXISTING, confidence: 'exact', reason: 'identical_file' })
    expect(queries).toHaveLength(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('registers a likely duplicate (same tenant and period) and returns it as a warning', async () => {
    const { service, db } = harness((query) =>
      callsTo(query, 'insert').length
        ? { data: statementRow(), error: null }
        : { data: [statementRow({ id: EXISTING, file_sha256: 'b'.repeat(64) })], error: null },
    )

    const result = await service.register(db, COMPANY, USER, body())

    expect(result.statement.status).toBe('uploaded')
    expect(result.duplicate).toMatchObject({ existingStatementId: EXISTING, confidence: 'likely', reason: 'same_tenant_period_and_number' })
  })

  it('only checks the file hash when no tenant is matched yet', async () => {
    const { service, db, queries } = harness((query) =>
      callsTo(query, 'insert').length ? { data: statementRow({ tenant_id: null }), error: null } : { data: [], error: null },
    )
    await service.register(db, COMPANY, USER, body({ tenantId: undefined }))
    expect(callsTo(queries[0]!, 'or')).toEqual([[`file_sha256.eq.${FILE_SHA}`]])
  })

  it('maps a unique violation (concurrent upload of the same file) to the duplicate 409', async () => {
    const { service, db } = harness((_query, index) => {
      if (index === 0) return { data: [], error: null }
      if (index === 1) return { data: null, error: { code: '23505', message: 'statements_company_sha256_live_idx' } }
      return { data: [statementRow({ id: EXISTING, file_sha256: FILE_SHA })], error: null }
    })
    const error = await service.register(db, COMPANY, USER, body()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DuplicateStatementException)
    expect((error as DuplicateStatementException).match.existingStatementId).toBe(EXISTING)
  })

  it('maps a unique violation on the id (storage path reused) to a plain 409', async () => {
    const { service, db } = harness((_query, index) => {
      if (index === 1) return { data: null, error: { code: '23505', message: 'statements_pkey' } }
      return { data: [], error: null }
    })
    const error = await service.register(db, COMPANY, USER, body()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect(error).not.toBeInstanceOf(DuplicateStatementException)
  })

  it.each([
    [`${'3ab0fc4a-eadb-50b8-bc4d-000000000000'}/${STATEMENT}/a.pdf`, 'another company'],
    [`${COMPANY}/a.pdf`, 'not the convention'],
  ])('rejects storage path %s (%s)', async (storagePath) => {
    const { service, db } = harness(() => ({ data: [], error: null }))
    await expect(service.register(db, COMPANY, USER, body({ storagePath }))).rejects.toBeInstanceOf(BadRequestException)
  })

  it('requires the file to be uploaded with the stated size', async () => {
    const missing = harness(() => ({ data: [], error: null }), { objectSize: null })
    await expect(missing.service.register(missing.db, COMPANY, USER, body())).rejects.toThrow(/Upload the file/)

    const wrongSize = harness(() => ({ data: [], error: null }), { objectSize: 1 })
    await expect(wrongSize.service.register(wrongSize.db, COMPANY, USER, body())).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(missing.queries).toHaveLength(0)

    const shorterFile = harness(() => ({ data: [], error: null }), { file: FILE.slice(1) })
    await expect(shorterFile.service.register(shorterFile.db, COMPANY, USER, body())).rejects.toThrow(/size does not match/)

    const gone = harness(() => ({ data: [], error: null }), { file: null })
    await expect(gone.service.register(gone.db, COMPANY, USER, body())).rejects.toThrow(/Upload the file/)
  })

  it('hashes the stored object and refuses a sha256 that does not match it with 422, before any query', async () => {
    const { service, db, queries, storageCalls, enqueue } = harness(() => ({ data: [], error: null }))

    const error = await service.register(db, COMPANY, USER, body({ sha256: 'b'.repeat(64) })).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect((error as UnprocessableEntityException).message).toMatch(/SHA-256 of the uploaded file does not match/)
    expect(storageCalls).toContainEqual({ bucket: 'statements', method: 'download', args: [PATH] })
    expect(queries).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("does not let a client claim another statement's digest: a different file is not reported as its duplicate", async () => {
    // The stored object differs from statement EXISTING; the client sends EXISTING's digest.
    const { service, db, queries } = harness(() => ({ data: [statementRow({ id: EXISTING, file_sha256: SHA })], error: null }))
    await expect(service.register(db, COMPANY, USER, body({ sha256: SHA }))).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(queries).toHaveLength(0)
  })

  it('detects an identical file by the digest computed from the stored bytes', async () => {
    const { service, db, queries } = harness(() => ({ data: [statementRow({ id: EXISTING, file_sha256: FILE_SHA })], error: null }))
    const error = await service.register(db, COMPANY, USER, body()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DuplicateStatementException)
    expect(callsTo(queries[0]!, 'or')[0]?.[0]).toContain(`file_sha256.eq.${FILE_SHA}`)
  })

  it('keeps the registered statement when the queue is down', async () => {
    const { service, db } = harness(
      (query) => (callsTo(query, 'insert').length ? { data: statementRow(), error: null } : { data: [], error: null }),
      { enqueueFails: true },
    )
    const result = await service.register(db, COMPANY, USER, body())
    expect(result.processingJobId).toBeNull()
    expect(result.statement.id).toBe(STATEMENT)
  })
})

describe('StatementUploadsService.register links', () => {
  const UNIT = '6f1d2c1e-0000-4000-8000-0000000000c1'
  const LEASE = '6f1d2c1e-0000-4000-8000-0000000000c2'
  const ELSEWHERE = '6f1d2c1e-0000-4000-8000-0000000000c9'
  const matchingLease = { property_id: PROPERTY, unit_id: UNIT, tenant_id: TENANT }

  function linked(records: { lease?: Record<string, unknown> | null; unit?: Record<string, unknown> | null }) {
    return harness((query) => {
      if (query.table === 'leases') return { data: records.lease ?? null, error: null }
      if (query.table === 'units') return { data: records.unit ?? null, error: null }
      return callsTo(query, 'insert').length ? { data: statementRow({ unit_id: UNIT, lease_id: LEASE }), error: null } : { data: [], error: null }
    })
  }

  it('registers a statement whose lease and unit belong to its property and tenant, checked in the active company', async () => {
    const { service, db, queries } = linked({ lease: matchingLease, unit: { property_id: PROPERTY } })

    const result = await service.register(db, COMPANY, USER, body({ leaseId: LEASE, unitId: UNIT }))

    expect(result.statement.id).toBe(STATEMENT)
    const lease = queries.find((query) => query.table === 'leases')
    const unit = queries.find((query) => query.table === 'units')
    expect(callsTo(lease!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', LEASE],
    ])
    expect(callsTo(unit!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', UNIT],
    ])
  })

  it('accepts matching ids written in uppercase', async () => {
    const { service, db } = linked({ lease: matchingLease, unit: { property_id: PROPERTY } })
    await expect(
      service.register(db, COMPANY, USER, body({ propertyId: PROPERTY.toUpperCase(), tenantId: TENANT.toUpperCase(), leaseId: LEASE, unitId: UNIT.toUpperCase() })),
    ).resolves.toMatchObject({ statement: { id: STATEMENT } })
  })

  it('refuses a lease of another property, tenant and unit and a unit on another property with 422 listing each mismatch', async () => {
    const { service, db, queries, enqueue } = linked({
      lease: { property_id: ELSEWHERE, unit_id: ELSEWHERE, tenant_id: ELSEWHERE },
      unit: { property_id: ELSEWHERE },
    })

    const error = await service.register(db, COMPANY, USER, body({ leaseId: LEASE, unitId: UNIT })).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect(((error as UnprocessableEntityException).getResponse() as { message: string[] }).message).toEqual([
      'The lease belongs to a different property than propertyId',
      'The lease belongs to a different tenant than tenantId',
      'The lease is for a different unit than unitId',
      'The unit belongs to a different property than propertyId',
    ])
    expect(queries.some((query) => callsTo(query, 'insert').length > 0)).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses a unit on another property without a lease', async () => {
    const { service, db } = linked({ unit: { property_id: ELSEWHERE } })
    await expect(service.register(db, COMPANY, USER, body({ unitId: UNIT }))).rejects.toThrow(UnprocessableEntityException)
  })

  it("checks the lease tenant only when tenantId is given, and otherwise files the statement under the lease's tenant and unit", async () => {
    const { service, db, queries } = linked({ lease: { ...matchingLease, tenant_id: ELSEWHERE } })
    await expect(service.register(db, COMPANY, USER, body({ leaseId: LEASE, tenantId: undefined }))).resolves.toBeDefined()

    const insert = queries.find((query) => callsTo(query, 'insert').length > 0)
    expect(callsTo(insert!, 'insert')[0]?.[0]).toMatchObject({ lease_id: LEASE, tenant_id: ELSEWHERE, unit_id: UNIT })
    // The duplicate check looks for the lease tenant's statements for the same period.
    const candidates = queries.find((query) => query.table === 'statements' && callsTo(query, 'or').length > 0)
    expect(callsTo(candidates!, 'or')).toEqual([
      [`file_sha256.eq.${FILE_SHA},and(tenant_id.eq.${ELSEWHERE},period_start.eq.2026-10-01,period_end.eq.2026-10-31)`],
    ])
  })

  it("warns about a likely duplicate of the lease tenant's statement when the body names only the lease", async () => {
    const { service, db } = harness((query) => {
      if (query.table === 'leases') return { data: matchingLease, error: null }
      return callsTo(query, 'insert').length
        ? { data: statementRow({ unit_id: UNIT, lease_id: LEASE }), error: null }
        : { data: [statementRow({ id: EXISTING, tenant_id: TENANT, file_sha256: 'b'.repeat(64) })], error: null }
    })
    const result = await service.register(db, COMPANY, USER, body({ leaseId: LEASE, tenantId: undefined }))
    expect(result.duplicate).toMatchObject({ existingStatementId: EXISTING, confidence: 'likely' })
  })

  it('keeps the tenant and unit given in the body', async () => {
    const { service, db, queries } = linked({ lease: matchingLease, unit: { property_id: PROPERTY } })
    await service.register(db, COMPANY, USER, body({ leaseId: LEASE, unitId: UNIT }))
    const insert = queries.find((query) => callsTo(query, 'insert').length > 0)
    expect(callsTo(insert!, 'insert')[0]?.[0]).toMatchObject({ lease_id: LEASE, tenant_id: TENANT, unit_id: UNIT })
  })

  it('refuses a lease or unit that is not in the active company', async () => {
    const { service, db } = linked({})
    const error = await service.register(db, COMPANY, USER, body({ leaseId: LEASE, unitId: UNIT })).catch((caught: unknown) => caught)
    expect(((error as UnprocessableEntityException).getResponse() as { message: string[] }).message).toEqual([
      'leaseId does not name a lease in the active company',
      'unitId does not name a unit in the active company',
    ])
  })
})

describe('registerStatementBodySchema', () => {
  it('requires the statement date and period instead of guessing them', () => {
    const parsed = registerStatementBodySchema.safeParse({ ...body(), statementDate: undefined, periodStart: undefined })
    expect(parsed.success).toBe(false)
  })

  it('rejects a period that ends before it starts, and non-PDF uploads', () => {
    expect(registerStatementBodySchema.safeParse({ ...body(), periodEnd: '2026-09-30' }).success).toBe(false)
    expect(registerStatementBodySchema.safeParse({ ...body(), mimeType: 'image/png' }).success).toBe(false)
  })
})

describe('StatementUploadsService.process', () => {
  it('re-enqueues an uploaded statement with the deterministic job id', async () => {
    const { service, db, queries, enqueue, enqueueOrRetry } = harness(() => ({ data: { id: STATEMENT, status: 'processing' }, error: null }))
    await expect(service.process(db, COMPANY, STATEMENT)).resolves.toEqual({
      statementId: STATEMENT,
      status: 'processing',
      jobId: `statement-processing.${COMPANY}.${STATEMENT}`,
      outcome: 'already_queued',
    })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', STATEMENT],
    ])
    expect(enqueueOrRetry).toHaveBeenCalledTimes(1)
    expect(enqueueOrRetry).toHaveBeenCalledWith('statement-processing', { companyId: COMPANY, statementId: STATEMENT })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('recovers a statement whose processing job is stuck as failed, and reports it', async () => {
    const { service, db } = harness(() => ({ data: { id: STATEMENT, status: 'uploaded' }, error: null }), { retryOutcome: 'retried' })
    await expect(service.process(db, COMPANY, STATEMENT)).resolves.toMatchObject({ status: 'uploaded', outcome: 'retried' })
  })

  it('refuses statements already under review or final', async () => {
    const { service, db, enqueue, enqueueOrRetry } = harness(() => ({ data: { id: STATEMENT, status: 'review_required' }, error: null }))
    await expect(service.process(db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(ConflictException)
    expect(enqueue).not.toHaveBeenCalled()
    expect(enqueueOrRetry).not.toHaveBeenCalled()
  })
})
