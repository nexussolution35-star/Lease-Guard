import { ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { statementVerificationProblems, type EntityId, type LeaseCandidate, type Statement, type StatementExtraction } from '@leaseguard/domain'

import { conflictWithDatabaseMessage, httpErrorFromDatabase, type DatabaseErrorLike } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import type { MarkStatementDuplicateBody, RejectStatementBody, VerifyStatementsBody } from './statement-verification.schemas'
import { StatementsService } from './statements.service'

/** What verifying a statement did. */
export interface StatementVerificationResult {
  statement: Statement
  /**
   * Whether monitoring for the statement's tenant was queued to run now. False when the queue was down: the
   * statement is verified either way and the daily monitoring run picks it up.
   */
  monitoringQueued: boolean
}

/** A statement as a verification result names it: its file and, when known, its statement number. */
export interface StatementVerificationSubject {
  statementId: EntityId
  /** Absent when the statement is not in the company. */
  fileName?: string
  statementNumber?: string
}

/** One statement verified as part of a batch. */
export interface StatementVerifiedInBatch extends StatementVerificationSubject {
  /** Whether monitoring for the statement's tenant was queued to run now (false: the daily run covers it). */
  monitoringQueued: boolean
}

/** One statement of a batch that was not verified, and every reason why. */
export interface StatementNotVerified extends StatementVerificationSubject {
  reasons: string[]
}

/** What verifying several statements did: each was verified on its own, so a refusal leaves the others verified. */
export interface StatementsVerificationResult {
  verified: StatementVerifiedInBatch[]
  notVerified: StatementNotVerified[]
}

/**
 * The database's reasons, written for users: P0001 (the statement is no longer under review) answers 409, 23514 (a
 * field is unresolved, the match is missing, no reason, an unusable duplicate target) answers 422 with each reason.
 */
const OUTCOME_ERRORS = {
  P0001: conflictWithDatabaseMessage,
  '23514': (error: DatabaseErrorLike) => new UnprocessableEntityException(error.message.split('; ')),
} as const

/**
 * The outcomes of a statement review: verify, reject with a reason, or mark as a duplicate of another statement. Each
 * runs as one database function under the caller's identity (20261121141736_statement_verification.sql): the database
 * checks the caller is a writer, writes the outcome, stamps who and when, closes the extraction review and the
 * statement's review event, and audits it. Verification is the only way figures reach a statement: they are the
 * reviewed extraction's values, never sent by the client.
 */
@Injectable()
export class StatementVerificationService {
  private readonly logger = new Logger(StatementVerificationService.name)

  constructor(
    private readonly statements: StatementsService,
    private readonly queue: QueueProducer,
  ) {}

  /**
   * Verifies a statement under review once every field is resolved and its tenant, unit and lease are set (422 with
   * every reason otherwise; 409 when it is not under review), then queues monitoring for its tenant.
   */
  async verify(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<StatementVerificationResult> {
    const statement = await this.statements.get(db, companyId, statementId)
    assertUnderReview(statement, 'verified')
    const [extraction, lease] = await Promise.all([this.extraction(db, companyId, statementId), this.lease(db, companyId, statement.leaseId)])
    const problems = statementVerificationProblems({ statement, extraction, ...(lease ? { lease } : {}) })
    if (problems.length > 0) throw new UnprocessableEntityException(problems)

    await this.call('Verify statement', db.rpc('verify_statement', { p_company_id: companyId, p_statement_id: statementId }))
    return { statement: await this.statements.get(db, companyId, statementId), monitoringQueued: await this.queueMonitoring(companyId, statementId) }
  }

  /**
   * Verifies several statements, one after another, each exactly as `verify` does on its own: its own checks, its own
   * database call (and so its own audit entry and closed review event) and its own monitoring job. A statement that
   * cannot be verified is reported with every reason and never undoes the others; the request itself fails only when
   * the statements cannot be read at all.
   */
  async verifyMany(db: DbClient, companyId: EntityId, body: VerifyStatementsBody): Promise<StatementsVerificationResult> {
    const { data, error } = await db
      .from('statements')
      .select('id, file_name, statement_number')
      .eq('company_id', companyId)
      .in('id', body.statementIds)
    if (error) throw httpErrorFromDatabase(error, 'List statements to verify')
    const named = new Map((data ?? []).map((row) => [row.id.toLowerCase(), row]))

    const result: StatementsVerificationResult = { verified: [], notVerified: [] }
    for (const statementId of body.statementIds) {
      const row = named.get(statementId.toLowerCase())
      const subject: StatementVerificationSubject = {
        statementId,
        ...(row ? { fileName: row.file_name } : {}),
        ...(row?.statement_number ? { statementNumber: row.statement_number } : {}),
      }
      if (!row) {
        result.notVerified.push({ ...subject, reasons: ['The statement was not found in this workspace'] })
        continue
      }
      try {
        const { monitoringQueued } = await this.verify(db, companyId, statementId)
        result.verified.push({ ...subject, monitoringQueued })
      } catch (refusal) {
        result.notVerified.push({ ...subject, reasons: this.reasonsFor(statementId, refusal) })
      }
    }
    return result
  }

  /** Why one statement of a batch was not verified, in the words a single verification would answer with. */
  private reasonsFor(statementId: EntityId, refusal: unknown): string[] {
    if (refusal instanceof HttpException && refusal.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR) {
      const response = refusal.getResponse()
      const message = typeof response === 'object' && response !== null && 'message' in response ? response.message : response
      if (Array.isArray(message) && message.every((reason) => typeof reason === 'string') && message.length > 0) return message
      if (typeof message === 'string' && message !== '') return [message]
      return [refusal.message]
    }
    this.logger.error(`Verify statement ${statementId} in a batch failed: ${refusal instanceof Error ? refusal.message : String(refusal)}`)
    return ['The statement could not be verified just now: try again']
  }

  /** Rejects a statement under review with a reason (409 when it is not under review). */
  async reject(db: DbClient, companyId: EntityId, statementId: EntityId, body: RejectStatementBody): Promise<Statement> {
    await this.call(
      'Reject statement',
      db.rpc('reject_statement', { p_company_id: companyId, p_statement_id: statementId, p_reason: body.reason }),
    )
    return this.statements.get(db, companyId, statementId)
  }

  /**
   * Marks a statement under review as a duplicate of another statement of the company that is not itself rejected or
   * a duplicate (422 otherwise; 409 when it is not under review).
   */
  async markDuplicate(db: DbClient, companyId: EntityId, statementId: EntityId, body: MarkStatementDuplicateBody): Promise<Statement> {
    await this.call(
      'Mark statement as duplicate',
      db.rpc('mark_statement_duplicate', {
        p_company_id: companyId,
        p_statement_id: statementId,
        p_duplicate_of_statement_id: body.duplicateOfStatementId,
      }),
    )
    return this.statements.get(db, companyId, statementId)
  }

  /** Runs one outcome function; null (the statement is not in the company) answers 404. */
  private async call(operation: string, request: PromiseLike<{ data: string | null; error: DatabaseErrorLike | null }>): Promise<void> {
    const { data, error } = await request
    if (error) throw httpErrorFromDatabase(error, operation, OUTCOME_ERRORS)
    if (!data) throw new NotFoundException('The record was not found')
  }

  private async queueMonitoring(companyId: EntityId, statementId: EntityId): Promise<boolean> {
    try {
      await this.queue.enqueue('statement-monitoring', { companyId, statementId })
      return true
    } catch (error) {
      this.logger.warn(
        `Statement ${statementId} verified but monitoring not queued (the daily run covers it): ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  private async extraction(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<StatementExtraction | null> {
    try {
      return await this.statements.getExtraction(db, companyId, statementId)
    } catch (error) {
      if (error instanceof NotFoundException) return null
      throw error
    }
  }

  private async lease(db: DbClient, companyId: EntityId, leaseId: EntityId | undefined): Promise<LeaseCandidate | undefined> {
    if (!leaseId) return undefined
    const { data, error } = await db
      .from('leases')
      .select('id, reference, status, commencement_date, expiry_date')
      .eq('company_id', companyId)
      .eq('id', leaseId)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load statement lease')
    if (!data) return undefined
    return { id: data.id, reference: data.reference, status: data.status, commencementDate: data.commencement_date, expiryDate: data.expiry_date }
  }
}

function assertUnderReview(statement: Pick<Statement, 'status'>, outcome: string): void {
  if (statement.status !== 'review_required') {
    throw new ConflictException(`The statement is ${statement.status.replace('_', ' ')}; only a statement under review can be ${outcome}`)
  }
}
