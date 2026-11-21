import { createHash, randomUUID } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  type HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  findDuplicateStatement,
  PDF_SIGNATURE_LENGTH,
  processingFailed,
  statementFileProblem,
  type DuplicateCandidate,
  type DuplicateMatch,
  type EntityId,
  type ExistingStatement,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { parseStorageObjectPath, storageObjectPath } from '../../infrastructure/storage/storage-paths'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { DuplicateStatementException } from './duplicate-statement.exception'
import type { ProcessStatementResult, RegisterStatementResult, StatementUploadUrl } from './statement-uploads.types'
import { toStatement, toStoredFile, type StatementRow } from './statements.mapper'
import {
  PROCESSABLE_STATEMENT_STATUSES,
  type CreateStatementUploadUrlBody,
  type RegisterStatementBody,
} from './statements.schemas'

/** Statements that take part in duplicate detection: the same set the live sha256 unique index covers. */
const NOT_LIVE_STATUSES = '(duplicate,rejected)'

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

/** The lease a statement is filed against, as far as the link checks need it. */
interface LinkedLease {
  property_id: EntityId
  unit_id: EntityId
  tenant_id: EntityId
}

function isProcessable(status: string): status is (typeof PROCESSABLE_STATEMENT_STATUSES)[number] {
  return (PROCESSABLE_STATEMENT_STATUSES as readonly string[]).includes(status)
}

/**
 * Statement upload flow: (1) sign an upload into the statements bucket, (2) register the uploaded file
 * as a statement with duplicate detection, (3) queue it for extraction. Every step runs with the
 * caller's RLS-bound client, so database and storage policies apply.
 */
@Injectable()
export class StatementUploadsService {
  private readonly logger = new Logger(StatementUploadsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly queue: QueueProducer,
  ) {}

  async createUploadUrl(db: DbClient, companyId: EntityId, body: CreateStatementUploadUrlBody): Promise<StatementUploadUrl> {
    this.storage.assertStatementSize(body.sizeBytes)
    const statementId = randomUUID()
    const bucket = this.storage.statementsBucket
    const signed = await this.storage.createSignedUploadUrl(db, bucket, storageObjectPath(companyId, statementId, body.fileName))
    return {
      statementId,
      bucket,
      storagePath: signed.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
      maxSizeBytes: this.storage.maxStatementBytes,
    }
  }

  /**
   * Registers an uploaded file as an `uploaded` statement and queues it for processing.
   *
   * The SHA-256 is computed here from the stored object (whose size is already capped) and must equal
   * the digest the client sent, or the request is refused with 422: a mismatch means the object at
   * storagePath is not the file the client meant to register (a failed or replaced upload, or a wrong
   * digest), and registering it anyway would monitor a file nobody checked. Duplicate detection and the
   * stored `file_sha256` therefore always use the server-computed digest, never the client's claim.
   *
   * A statement filed against a lease takes its tenant and unit from that lease when the body leaves
   * them out, so the statement (and its duplicate check) is always tied to the lease's tenant.
   *
   * Duplicates are checked with the domain rule `findDuplicateStatement` against the company's live
   * statements before inserting: an identical file (SHA-256) is refused with 409 naming the statement
   * on record, and the copy just uploaded is removed so it is never processed; a likely match (same tenant, period and number, not known to be for another unit or lease) is registered and returned as a warning
   * for the reviewer, because the period may be wrong. A concurrent registration of the same file loses
   * on the live unique index and is reported the same way.
   */
  async register(
    db: DbClient,
    companyId: EntityId,
    userId: EntityId,
    body: RegisterStatementBody,
  ): Promise<RegisterStatementResult> {
    this.storage.assertStatementSize(body.sizeBytes)
    const location = parseStorageObjectPath(body.storagePath)
    if (!location || location.companyId !== companyId) {
      throw new BadRequestException('storagePath must be a path returned by createStatementUploadUrl for the active company')
    }

    const object = await this.storage.objectInfo(db, this.storage.statementsBucket, body.storagePath)
    if (!object) throw new UnprocessableEntityException('Upload the file to storagePath before registering the statement')
    if (object.sizeBytes !== undefined && object.sizeBytes !== body.sizeBytes) {
      throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    }
    const sha256 = await this.storedFileSha256(db, body)

    const lease = await this.assertLinksBelongTogether(db, companyId, body)
    const tenantId = body.tenantId ?? lease?.tenant_id
    const unitId = body.unitId ?? lease?.unit_id

    const candidate: DuplicateCandidate = {
      file: {
        fileName: body.fileName,
        storagePath: body.storagePath,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        sha256,
      },
      ...(tenantId ? { tenantId } : {}),
      ...(unitId ? { unitId } : {}),
      ...(body.leaseId ? { leaseId: body.leaseId } : {}),
      ...(body.periodStart ? { periodStart: body.periodStart } : {}),
      ...(body.periodEnd ? { periodEnd: body.periodEnd } : {}),
      ...(body.statementNumber ? { statementNumber: body.statementNumber } : {}),
    }
    const duplicate = findDuplicateStatement(candidate, await this.liveCandidates(db, companyId, candidate))
    if (duplicate?.confidence === 'exact') throw await this.refuseIdenticalFile(db, companyId, body.storagePath, duplicate)

    const { data: row, error } = await db
      .from('statements')
      .insert({
        id: location.entityId,
        company_id: companyId,
        property_id: body.propertyId,
        tenant_id: tenantId ?? null,
        unit_id: unitId ?? null,
        lease_id: body.leaseId ?? null,
        file_name: body.fileName,
        storage_path: body.storagePath,
        mime_type: body.mimeType,
        size_bytes: body.sizeBytes,
        file_sha256: sha256,
        source_system: body.sourceSystem,
        statement_number: body.statementNumber ?? null,
        // As typed, or null: the document supplies them and processing flags any difference.
        statement_date: body.statementDate ?? null,
        period_start: body.periodStart ?? null,
        period_end: body.periodEnd ?? null,
        // Status is not insertable: a new statement is always `uploaded` (the column default). The database stamps
        // the uploader and time from the session and audits the upload.
        upload_batch_id: body.uploadBatchId ?? null,
        uploaded_by_user_id: userId,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw await this.conflictAfterRace(db, companyId, candidate, body.storagePath)
      throw httpErrorFromDatabase(error, 'Register statement')
    }

    const statement = toStatement(row)
    return { statement, duplicate: duplicate ?? null, processingJobId: await this.tryEnqueue(companyId, statement.id) }
  }

  /**
   * Queues processing again for a statement that has not reached review, or whose automatic extraction
   * failed (`processingFailed`: left `review_required` with `processing_error`). A failed statement goes
   * back to `uploaded` with the error cleared through public.retry_statement_processing (the database checks
   * the caller is a writer; a signed-in caller cannot write a statement's status or processing error directly,
   * 20261121194500_statement_review_integrity.sql) before it is queued. If it cannot be queued it stays
   * `uploaded`, like a registration the queue missed, and processing it again queues it. Idempotent per statement: a job still waiting
   * or running is left alone, and a job that failed or completed without moving the statement on is run
   * again (`QueueProducer.enqueueOrRetry`); `outcome` says which.
   */
  async process(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<ProcessStatementResult> {
    const row = unwrapDatabase(
      await db.from('statements').select('id, status, processing_error').eq('company_id', companyId).eq('id', statementId).maybeSingle(),
      'Get statement',
    )
    if (processingFailed({ status: row.status, ...(row.processing_error !== null ? { processingError: row.processing_error } : {}) })) {
      return this.retryFailed(db, companyId, row.id)
    }
    if (!isProcessable(row.status)) {
      throw new ConflictException(
        `The statement is ${row.status.replace('_', ' ')}; only uploaded or processing statements, or ones whose processing failed, can be processed`,
      )
    }
    const { jobId, outcome } = await this.queue.enqueueOrRetry('statement-processing', { companyId, statementId: row.id })
    return { statementId: row.id, status: row.status, jobId, outcome }
  }

  private async retryFailed(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<ProcessStatementResult> {
    const { data, error } = await db.rpc('retry_statement_processing', { p_company_id: companyId, p_statement_id: statementId })
    if (error) {
      throw httpErrorFromDatabase(error, 'Reset failed statement', {
        // The statement is no longer a failed one (another request reset it, or it moved on).
        P0001: () => new ConflictException('The statement changed while it was being queued again; reload it and try again'),
      })
    }
    if (!data) throw new NotFoundException('The record was not found')
    const { jobId, outcome } = await this.queue.enqueueOrRetry('statement-processing', { companyId, statementId })
    return { statementId, status: 'uploaded', jobId, outcome }
  }

  /**
   * SHA-256 (lowercase hex) of the object at storagePath, read through the caller's client. Refused with
   * 422 when the object is gone, its size differs from sizeBytes, it is not a PDF (`%PDF-` header), or the digest
   * differs from body.sha256.
   */
  private async storedFileSha256(db: DbClient, body: RegisterStatementBody): Promise<string> {
    const file = await this.storage.download(db, this.storage.statementsBucket, body.storagePath)
    if (!file) throw new UnprocessableEntityException('Upload the file to storagePath before registering the statement')
    if (file.size !== body.sizeBytes) throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Checked by content, not by the declared type: the document-processing service reads PDFs only.
    const problem = statementFileProblem({ sizeBytes: bytes.byteLength, head: bytes.subarray(0, PDF_SIGNATURE_LENGTH), maxBytes: this.storage.maxStatementBytes })
    if (problem) throw new UnprocessableEntityException(problem.message)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== body.sha256) {
      throw new UnprocessableEntityException('The SHA-256 of the uploaded file does not match sha256; upload the file again')
    }
    return sha256
  }

  /**
   * The database only checks that the property, tenant, unit and lease exist in the company (and that
   * the unit is on the property). A statement filed against a lease must also match that lease's
   * property, tenant and unit, and a unit must be on the property, or the statement would be monitored
   * against the wrong account. Every mismatch is listed in one 422. Returns the lease, when one is given.
   */
  private async assertLinksBelongTogether(db: DbClient, companyId: EntityId, body: RegisterStatementBody): Promise<LinkedLease | null> {
    const { leaseId, unitId } = body
    if (!leaseId && !unitId) return null
    const [lease, unit] = await Promise.all([
      leaseId
        ? db.from('leases').select('property_id, unit_id, tenant_id').eq('company_id', companyId).eq('id', leaseId).maybeSingle()
        : undefined,
      unitId ? db.from('units').select('property_id').eq('company_id', companyId).eq('id', unitId).maybeSingle() : undefined,
    ])
    if (lease?.error) throw httpErrorFromDatabase(lease.error, 'Load statement lease')
    if (unit?.error) throw httpErrorFromDatabase(unit.error, 'Load statement unit')

    const mismatches: string[] = []
    if (leaseId) {
      const row = lease?.data
      if (!row) {
        mismatches.push('leaseId does not name a lease in the active company')
      } else {
        if (!sameId(row.property_id, body.propertyId)) mismatches.push('The lease belongs to a different property than propertyId')
        if (body.tenantId && !sameId(row.tenant_id, body.tenantId)) mismatches.push('The lease belongs to a different tenant than tenantId')
        if (unitId && !sameId(row.unit_id, unitId)) mismatches.push('The lease is for a different unit than unitId')
      }
    }
    if (unitId) {
      const row = unit?.data
      if (!row) mismatches.push('unitId does not name a unit in the active company')
      else if (!sameId(row.property_id, body.propertyId)) mismatches.push('The unit belongs to a different property than propertyId')
    }
    if (mismatches.length > 0) throw new UnprocessableEntityException(mismatches)
    return lease?.data ?? null
  }

  /** Live statements that could match: same file hash, or same tenant and period. */
  private async liveCandidates(db: DbClient, companyId: EntityId, candidate: DuplicateCandidate): Promise<ExistingStatement[]> {
    // Every interpolated value is validated or read from the database (hex digest, uuid, ISO date), so
    // it cannot alter the filter.
    const conditions = [`file_sha256.eq.${candidate.file.sha256}`]
    if (candidate.tenantId && candidate.periodStart && candidate.periodEnd) {
      conditions.push(`and(tenant_id.eq.${candidate.tenantId},period_start.eq.${candidate.periodStart},period_end.eq.${candidate.periodEnd})`)
    }
    const { data, error } = await db
      .from('statements')
      .select('*')
      .eq('company_id', companyId)
      .not('status', 'in', NOT_LIVE_STATUSES)
      .or(conditions.join(','))
      .order('uploaded_at', { ascending: true })
    if (error) throw httpErrorFromDatabase(error, 'Check statement duplicates')
    return (data ?? []).map(toExistingStatement)
  }

  /**
   * An identical file is never processed twice: the copy just uploaded is removed from the statements bucket and the
   * 409 names the statement on record. A path that a statement already points at (the same registration sent again)
   * is never removed. Removing is best effort; a copy left behind is harmless because no statement points at it.
   */
  private async refuseIdenticalFile(
    db: DbClient,
    companyId: EntityId,
    storagePath: string,
    match: DuplicateMatch,
  ): Promise<DuplicateStatementException> {
    try {
      const { data, error } = await db
        .from('statements')
        .select('id')
        .eq('company_id', companyId)
        .eq('storage_path', storagePath)
        .limit(1)
      if (error) throw new Error(error.message)
      if ((data ?? []).length === 0) await this.storage.removeObject(db, this.storage.statementsBucket, storagePath)
    } catch (error) {
      this.logger.warn(`Identical upload ${storagePath} was not removed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return new DuplicateStatementException(match)
  }

  /** A unique violation on insert: another request registered the same file, or the same storage path. */
  private async conflictAfterRace(db: DbClient, companyId: EntityId, candidate: DuplicateCandidate, storagePath: string): Promise<HttpException> {
    const { data, error } = await db
      .from('statements')
      .select('*')
      .eq('company_id', companyId)
      .not('status', 'in', NOT_LIVE_STATUSES)
      .eq('file_sha256', candidate.file.sha256)
    if (error) return httpErrorFromDatabase(error, 'Check statement duplicates')
    const match: DuplicateMatch | null = findDuplicateStatement(candidate, (data ?? []).map(toExistingStatement))
    if (match?.confidence === 'exact') return this.refuseIdenticalFile(db, companyId, storagePath, match)
    return new ConflictException('A statement is already registered for this storage path; request a new upload URL')
  }

  /**
   * The statement is saved even when Redis is down: the response says so (null job id) and
   * processStatement retries. Failing the request instead would make a retry look like a duplicate.
   */
  private async tryEnqueue(companyId: EntityId, statementId: EntityId): Promise<string | null> {
    try {
      return await this.queue.enqueue('statement-processing', { companyId, statementId })
    } catch (error) {
      this.logger.warn(
        `Statement ${statementId} registered but not queued: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }
}

/** Uuids compare case-insensitively: Postgres returns them lowercase, request bodies may not. */
function sameId(a: EntityId, b: EntityId): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function toExistingStatement(row: StatementRow): ExistingStatement {
  return {
    id: row.id,
    file: toStoredFile(row),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.unit_id ? { unitId: row.unit_id } : {}),
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.period_start !== null ? { periodStart: row.period_start } : {}),
    ...(row.period_end !== null ? { periodEnd: row.period_end } : {}),
    ...(row.statement_number !== null ? { statementNumber: row.statement_number } : {}),
  }
}
