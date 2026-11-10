import type { DuplicateMatch, EntityId, Statement, StatementStatus } from '@leaseguard/domain'

import type { ApiErrorBody } from '../../common/filters/all-exceptions.filter'
import type { EnqueueOutcome } from '../../infrastructure/queues/queue-producer'
import type { PROCESSABLE_STATEMENT_STATUSES } from './statements.schemas'

/** Where and how the browser uploads a statement file before registering it. */
export interface StatementUploadUrl {
  statementId: EntityId
  bucket: string
  storagePath: string
  signedUrl: string
  token: string
  maxSizeBytes: number
}

export interface RegisterStatementResult {
  statement: Statement
  /** A `likely` duplicate the reviewer should check. Exact duplicates are refused with 409 instead. */
  duplicate: DuplicateMatch | null
  /** Null when the processing queue was unavailable; the statement stays `uploaded`. */
  processingJobId: string | null
}

export interface ProcessStatementResult {
  statementId: EntityId
  status: Extract<StatementStatus, (typeof PROCESSABLE_STATEMENT_STATUSES)[number]>
  jobId: string
  /** What happened to the processing job: added, left queued, or a failed / completed job run again. */
  outcome: EnqueueOutcome
}

/** 409 body for an exact duplicate: the standard error body plus the statement already on record. */
export interface DuplicateStatementErrorBody extends ApiErrorBody {
  duplicate: DuplicateMatch
}
