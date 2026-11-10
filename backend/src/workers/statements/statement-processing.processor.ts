import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import {
  assessDocumentExtraction,
  DEFAULT_MIN_FINANCIAL_CONFIDENCE,
  MONITORED_LEASE_STATUSES,
  type DocumentExtractionResult,
  type EntityId,
  type EventPriority,
  type ExtractionAssessment,
} from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import { DocumentProcessingClient, DocumentProcessingError } from '../../infrastructure/document-processing/document-processing.client'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { fetchAll, unwrap, WorkerDatabaseError } from '../shared/db'
import { type EventDraft, MonitoringOutputs } from '../shared/monitoring-outputs'
import { loadMonitoringSettings, type RuleSettings } from '../shared/monitoring-settings'
import { StatementFiles, StorageDownloadError } from '../shared/statement-files'
import {
  type MatchCandidate,
  proposeMatch,
  toExtractionFieldInserts,
  toExtractionInsert,
  toLineItemInserts,
} from './statement-extraction.mapper'

type StatementRow = Pick<
  Tables<'statements'>,
  'id' | 'company_id' | 'property_id' | 'tenant_id' | 'unit_id' | 'lease_id' | 'file_name' | 'storage_path' | 'mime_type' | 'size_bytes' | 'source_system' | 'status'
>

export type StatementProcessingOutcome =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'proposal_stored'; extractionId: EntityId; uncertainFinancialFields: number; lineItemsSkipped: number }
  | { outcome: 'review_without_proposal'; reason: string }

/** Statuses from which a statement may be (re)processed; anything else was already handled. */
const PROCESSABLE = ['uploaded', 'processing'] as const
const MAX_HINTS = 200

/** A failure that retrying will not fix; the statement is left reviewable with this reason. */
class PermanentStatementError extends Error {}

function failureOf(error: unknown): { retryable: boolean; reason: string } {
  if (error instanceof DocumentProcessingError || error instanceof StorageDownloadError) {
    return { retryable: error.retryable, reason: error.message }
  }
  if (error instanceof WorkerDatabaseError) return { retryable: true, reason: error.message }
  if (error instanceof PermanentStatementError || error instanceof UnrecoverableError) return { retryable: false, reason: error.message }
  return { retryable: true, reason: error instanceof Error ? error.message : String(error) }
}

/**
 * Extracts an uploaded statement through the document-processing service and stores the result as a
 * PROPOSAL for human review (statement_extractions status pending_review + one row per field). It never
 * writes verified figures: the statement becomes `review_required` and a person confirms or corrects
 * every value. Transient failures are retried; permanent ones (unreadable PDF, contract violation,
 * missing file) and exhausted retries leave the statement `review_required` with `processing_error`.
 */
@Injectable()
export class StatementProcessingProcessor implements OnModuleInit {
  private readonly logger = new Logger(StatementProcessingProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly files: StatementFiles,
    private readonly extractor: DocumentProcessingClient,
    private readonly clock: Clock,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  onModuleInit(): void {
    this.runtime.start('statement-processing', (payload, attempt) => this.process(payload, attempt), { concurrency: 2 })
  }

  async process({ companyId, statementId }: JobPayloads['statement-processing'], attempt: JobAttempt): Promise<StatementProcessingOutcome> {
    const db = this.clients.get()
    const statementResult = await db
      .from('statements')
      .select('id, company_id, property_id, tenant_id, unit_id, lease_id, file_name, storage_path, mime_type, size_bytes, source_system, status')
      .eq('company_id', companyId)
      .eq('id', statementId)
      .maybeSingle()
    const statement = unwrap(statementResult, 'Load statement', null)
    if (!statement) throw new UnrecoverableError(`Statement ${statementId} does not exist in company ${companyId}`)
    if (!(PROCESSABLE as readonly string[]).includes(statement.status)) {
      return { outcome: 'skipped', reason: `statement is already ${statement.status}` }
    }
    const settings = await loadMonitoringSettings(db, companyId)
    if (!settings) return { outcome: 'skipped', reason: 'company is not active' }
    const reviewRule = settings.rule('statement_review_required')
    // A company rule may only make pre-filling stricter than the domain default, never looser.
    const minConfidence = Math.max(DEFAULT_MIN_FINANCIAL_CONFIDENCE, reviewRule.config?.confidenceThreshold ?? 0)

    try {
      return await this.extractAndPropose(db, statement, reviewRule, minConfidence, attempt)
    } catch (error) {
      // Every failure while the statement is processable ends here. Transient ones are retried (the
      // statement stays processable and every write below is idempotent); permanent ones and the last
      // attempt always leave the statement reviewable with processing_error.
      const failure = failureOf(error)
      if (failure.retryable && !isFinalAttempt(attempt)) throw error
      const reason = failure.retryable ? `Automatic extraction failed after ${attempt.attempt} attempts: ${failure.reason}` : failure.reason
      await this.leaveForManualReview(db, statement, reviewRule, reason, attempt)
      throw new UnrecoverableError(reason)
    }
  }

  /**
   * Extraction → proposal → review outputs → status. The statement becomes `review_required` LAST, after
   * the review event and notification exist: once it leaves the processable statuses a retry skips it,
   * so anything not yet written would be lost.
   */
  private async extractAndPropose(
    db: DbClient,
    statement: StatementRow,
    reviewRule: RuleSettings<'statement_review_required'>,
    minConfidence: number,
    attempt: JobAttempt,
  ): Promise<StatementProcessingOutcome> {
    const companyId = statement.company_id
    await this.setStatus(db, statement, 'processing', null)

    if (statement.mime_type !== 'application/pdf') {
      throw new PermanentStatementError('Only PDF statements can be extracted automatically; enter the figures manually')
    }
    const maxBytes = this.env.DOCUMENT_PROCESSING_MAX_FILE_MB * 1024 * 1024
    if (statement.size_bytes > maxBytes) {
      throw new PermanentStatementError(`The file is larger than ${this.env.DOCUMENT_PROCESSING_MAX_FILE_MB} MB and cannot be extracted automatically`)
    }
    const [file, candidates] = await Promise.all([this.files.download(companyId, statement.storage_path), this.loadCandidates(db, statement)])
    const result = await this.extractor.extract(file, statement.file_name, {
      companyId,
      statementId: statement.id,
      sourceSystem: statement.source_system,
      expectedTenantNames: [...new Set(candidates.tenants.flatMap((t) => t.names))].slice(0, MAX_HINTS),
      expectedUnitNumbers: [...new Set(candidates.units.flatMap((u) => u.names))].slice(0, MAX_HINTS),
    })

    const assessment = assessDocumentExtraction(result, minConfidence)
    if (assessment.contractErrors.length > 0) {
      throw new PermanentStatementError(`Document processing response breaks the extraction contract: ${assessment.contractErrors.join('; ')}`)
    }
    if (!assessment.usable) {
      const issues = result.issues.map((issue) => issue.message).join('; ')
      const reason = `The statement could not be read automatically${issues ? `: ${issues}` : ''}`
      await this.leaveForManualReview(db, statement, reviewRule, reason, attempt)
      return { outcome: 'review_without_proposal', reason }
    }

    const extractionId = await this.storeProposal(db, statement, result, assessment, candidates)
    const lineItems = toLineItemInserts(companyId, statement.id, result, minConfidence)
    if (lineItems.rows.length > 0) {
      const lineResult = await db
        .from('statement_line_items')
        .upsert(lineItems.rows, { onConflict: 'statement_id,line_number', ignoreDuplicates: true })
      unwrap(lineResult, 'Store proposed statement lines', null)
    }
    await this.raiseReview(db, statement, reviewRule, {
      blocking: assessment.hasBlockingIssues || assessment.uncertainFinancialFields.length > 0,
      description: this.reviewSummary(assessment, lineItems.skipped),
    })
    await this.setStatus(db, statement, 'review_required', null)
    this.logger.log(
      { companyId, statementId: statement.id, extractionId, uncertain: assessment.uncertainFinancialFields.length, lineItemsSkipped: lineItems.skipped },
      'Statement extracted; review required',
    )
    return {
      outcome: 'proposal_stored',
      extractionId,
      uncertainFinancialFields: assessment.uncertainFinancialFields.length,
      lineItemsSkipped: lineItems.skipped,
    }
  }

  /** Statement extraction + fields, idempotent per statement (a retry reuses the stored proposal). */
  private async storeProposal(
    db: DbClient,
    statement: StatementRow,
    result: DocumentExtractionResult,
    assessment: ExtractionAssessment,
    candidates: { tenants: MatchCandidate[]; units: MatchCandidate[] },
  ): Promise<EntityId> {
    const companyId = statement.company_id
    const match = proposeMatch(result, candidates.tenants, candidates.units)
    const insertResult = await db
      .from('statement_extractions')
      .upsert(toExtractionInsert(companyId, statement.id, result, match, this.clock.now().toISOString()), {
        onConflict: 'statement_id',
        ignoreDuplicates: true,
      })
    unwrap(insertResult, 'Store statement extraction', null)
    const extractionResult = await db
      .from('statement_extractions')
      .select('id, status')
      .eq('company_id', companyId)
      .eq('statement_id', statement.id)
      .maybeSingle()
    const extraction = unwrap(extractionResult, 'Load statement extraction', null)
    if (!extraction) throw new WorkerDatabaseError('Load statement extraction', { code: 'missing', message: 'not found after insert' })
    if (extraction.status === 'pending_review') {
      const fieldsResult = await db
        .from('statement_extraction_fields')
        .upsert(toExtractionFieldInserts(companyId, extraction.id, result, assessment), {
          onConflict: 'extraction_id,name',
          ignoreDuplicates: true,
          defaultToNull: false,
        })
      unwrap(fieldsResult, 'Store extracted fields', null)
    }
    return extraction.id
  }

  /** Tenants and units the statement may belong to: its own when matched at upload, else its property's. */
  private async loadCandidates(db: DbClient, statement: StatementRow): Promise<{ tenants: MatchCandidate[]; units: MatchCandidate[] }> {
    const companyId = statement.company_id
    let tenantIds: EntityId[]
    if (statement.tenant_id) {
      tenantIds = [statement.tenant_id]
    } else {
      const leases = await fetchAll('Load property leases', (from, to) =>
        db
          .from('leases')
          .select('tenant_id')
          .eq('company_id', companyId)
          .eq('property_id', statement.property_id)
          .in('status', [...MONITORED_LEASE_STATUSES, 'pending_verification'])
          .order('id')
          .range(from, to),
      )
      tenantIds = [...new Set(leases.map((lease) => lease.tenant_id))].slice(0, MAX_HINTS)
    }
    const tenantsResult =
      tenantIds.length === 0
        ? { data: [], error: null }
        : await db.from('tenants').select('id, trading_name, legal_name').eq('company_id', companyId).in('id', tenantIds)
    const tenants = unwrap(tenantsResult, 'Load candidate tenants', [])

    let unitsQuery = db.from('units').select('id, unit_number').eq('company_id', companyId).eq('property_id', statement.property_id)
    if (statement.unit_id) unitsQuery = unitsQuery.eq('id', statement.unit_id)
    const unitsResult = await unitsQuery.order('id').limit(MAX_HINTS)
    const units = unwrap(unitsResult, 'Load candidate units', [])

    return {
      tenants: tenants.map((t) => ({ id: t.id, names: [t.trading_name, t.legal_name] })),
      units: units.map((u) => ({ id: u.id, names: [u.unit_number] })),
    }
  }

  private async setStatus(db: DbClient, statement: StatementRow, status: 'processing' | 'review_required', processingError: string | null): Promise<void> {
    const result = await db
      .from('statements')
      .update({ status, processing_error: processingError })
      .eq('company_id', statement.company_id)
      .eq('id', statement.id)
      .in('status', [...PROCESSABLE])
    unwrap(result, `Set statement status ${status}`, null)
  }

  /**
   * No usable proposal: the statement waits for manual entry, with the reason recorded. The review event
   * and notification are raised first (idempotent), then the status is set. If raising fails while
   * attempts remain, the error propagates and the retry, finding the statement still processable,
   * raises them again; on the last attempt the statement is made reviewable regardless.
   */
  private async leaveForManualReview(
    db: DbClient,
    statement: StatementRow,
    rule: RuleSettings<'statement_review_required'>,
    reason: string,
    attempt: JobAttempt,
  ): Promise<void> {
    try {
      await this.raiseReview(db, statement, rule, {
        blocking: true,
        description: `Automatic extraction did not produce figures: ${reason}. Enter and verify the statement figures manually.`,
      })
    } catch (error) {
      if (!isFinalAttempt(attempt)) throw error
      this.logger.error(
        { companyId: statement.company_id, statementId: statement.id, err: String(error) },
        'Could not raise the statement review event on the last attempt; leaving the statement reviewable anyway',
      )
    }
    await this.setStatus(db, statement, 'review_required', reason.slice(0, 2000))
    this.logger.warn({ companyId: statement.company_id, statementId: statement.id, reason }, 'Statement left for manual review')
  }

  /** 'statement_review_required' event (unless the company disabled it) and a notification to the manager. */
  private async raiseReview(
    db: DbClient,
    statement: StatementRow,
    rule: RuleSettings<'statement_review_required'>,
    review: { blocking: boolean; description: string },
  ): Promise<void> {
    const companyId = statement.company_id
    const propertyResult = await db.from('properties').select('manager_user_id').eq('company_id', companyId).eq('id', statement.property_id).maybeSingle()
    const property = unwrap(propertyResult, 'Load statement property', null)
    const manager = rule.defaultAssigneeUserId ?? property?.manager_user_id
    const priority: EventPriority = review.blocking ? 'high' : (rule.defaultPriority ?? 'medium')
    const outputs = new MonitoringOutputs(db, companyId)
    if (rule.enabled) {
      const draft: EventDraft = {
        dedupeKey: `statement_review_required:${statement.id}`,
        type: 'statement_review_required',
        propertyId: statement.property_id,
        ...(statement.unit_id ? { unitId: statement.unit_id } : {}),
        ...(statement.tenant_id ? { tenantId: statement.tenant_id } : {}),
        ...(statement.lease_id ? { leaseId: statement.lease_id } : {}),
        statementId: statement.id,
        ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
        title: `Statement review required: ${statement.file_name}`,
        description: review.description,
        identifiedOn: this.clock.today(),
        priority,
        recommendedAction: 'Review the extracted values against the PDF, correct anything flagged and verify the statement.',
        ...(manager ? { assignedToUserId: manager } : {}),
      }
      await outputs.raise([draft], { notify: false })
    }
    if (manager) {
      await outputs.notify([
        {
          dedupeKey: `statement_review:${statement.id}:${manager}`,
          userId: manager,
          type: 'statement_review',
          severity: review.blocking ? 'warning' : 'info',
          title: `Statement ready for review: ${statement.file_name}`,
          body: review.description,
          link: { entityType: 'statement', entityId: statement.id },
        },
      ])
    }
  }

  private reviewSummary(assessment: ExtractionAssessment, lineItemsSkipped: number): string {
    const parts = ['Extracted values are a proposal and must be checked before the statement is verified.']
    if (assessment.uncertainFinancialFields.length > 0) {
      parts.push(
        `Amounts that need entering or checking: ${assessment.uncertainFinancialFields.map((f) => `${f.name.replaceAll('_', ' ')} (${f.reason.replace('_', ' ')})`).join(', ')}.`,
      )
    }
    if (assessment.hasBlockingIssues) parts.push('The extractor reported errors on this statement.')
    if (lineItemsSkipped > 0) parts.push(`${lineItemsSkipped} statement line(s) could not be read and were left out.`)
    return parts.join(' ')
  }
}
