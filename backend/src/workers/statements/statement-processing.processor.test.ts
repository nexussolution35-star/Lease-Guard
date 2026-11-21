import type { DocumentExtractionField, DocumentExtractionResult } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { WorkerEnv } from '../../config/env'
import { type DocumentProcessingClient, DocumentProcessingError } from '../../infrastructure/document-processing/document-processing.client'
import { extractionResult } from '../../infrastructure/document-processing/document-processing.test-helpers'
import type { StatementFiles } from '../shared/statement-files'
import { clientsFor, COMPANY, companySettingsRow, eqValue, fixedClock, isWrite, MANAGER, PROPERTY, router, STATEMENT, TENANT, unusedRuntime } from '../workers.test-helpers'
import { StatementProcessingProcessor } from './statement-processing.processor'

const statementRow = {
  id: STATEMENT,
  company_id: COMPANY,
  property_id: PROPERTY,
  tenant_id: TENANT as string | null,
  unit_id: null,
  lease_id: null,
  file_name: 'october.pdf',
  storage_path: `${COMPANY}/${STATEMENT}/october.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 120_000,
  source_system: 'MRI',
  status: 'uploaded',
  statement_number: null as string | null,
  statement_date: null as string | null,
  period_start: null as string | null,
  period_end: null as string | null,
}

const field = (name: DocumentExtractionField['name'], value: string | null, flagged = false): DocumentExtractionField => ({
  name,
  rawText: value ?? '',
  value,
  confidence: 0.96,
  flagged,
  reason: null,
})

const goodResult = extractionResult({
  fields: [
    field('tenant_name', 'Test Trading'),
    field('unit_number', 'Shop 1'),
    field('statement_number', 'ST-1042'),
    field('statement_date', '2026-10-01'),
    field('period_start', '2026-10-01'),
    field('period_end', '2026-10-31'),
    field('opening_balance', '0.00'),
    field('rental_charged', '35000.00'),
    field('additional_charges', '0.00'),
    field('payments_received', null, true),
    field('outstanding_balance', '35000.00'),
    field('total_due', '35000.00'),
  ],
})

function harness(
  options: {
    statement?: Partial<typeof statementRow>
    extract?: () => Promise<DocumentExtractionResult>
    respond?: (query: RecordedQuery) => FakeResult | undefined
  } = {},
) {
  const db = fakeDb(
    router({
      respond: options.respond,
      reads: {
        statements: [{ ...statementRow, ...options.statement }],
        companies: [companySettingsRow],
        tenants: [{ id: TENANT, trading_name: 'Test Trading', legal_name: 'Test Trading (Pty) Ltd' }],
        units: [],
        properties: [{ manager_user_id: MANAGER }],
        statement_extractions: [{ id: 'ext-1', status: 'pending_review' }],
      },
    }),
  )
  const download = vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }))
  const extract = vi.fn(options.extract ?? (async () => goodResult))
  const processor = new StatementProcessingProcessor(
    unusedRuntime,
    clientsFor(db.client),
    { download } as unknown as StatementFiles,
    { extract } as unknown as DocumentProcessingClient,
    fixedClock('2026-11-09T06:00:00Z'),
    { DOCUMENT_PROCESSING_MAX_FILE_MB: 20 } as WorkerEnv,
  )
  return { processor, queries: db.queries, download, extract }
}

const statementUpdates = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table === 'statements' && isWrite(q)).map((q) => callsTo(q, 'update')[0][0])
const upsertsInto = (queries: RecordedQuery[], table: string) =>
  queries.filter((q) => q.table === table && isWrite(q)).map((q) => callsTo(q, 'upsert')[0])

const connectionLost: FakeResult = { data: null, error: { code: 'PGRST000', message: 'connection lost' } }
const isStatusUpdate = (query: RecordedQuery, status: string) =>
  query.table === 'statements' && isWrite(query) && (callsTo(query, 'update')[0][0] as { status: string }).status === status
/** Fails the first `times` writes matching `match` with a connection error. */
function failWrites(match: (query: RecordedQuery) => boolean, times = Number.POSITIVE_INFINITY): (query: RecordedQuery) => FakeResult | undefined {
  let failed = 0
  return (query) => {
    if (!isWrite(query) || !match(query) || failed >= times) return undefined
    failed++
    return connectionLost
  }
}
const lastAttempt = { attempt: 5, maxAttempts: 5 }
const withLineItem = extractionResult({
  ...goodResult,
  lineItems: [{ date: '2026-10-01', description: 'Rental', category: 'rental', kind: 'charge', amount: '35000.00', confidence: 0.99, flagged: false }],
})

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('StatementProcessingProcessor', () => {
  it('stores the extraction as a pending proposal and leaves the statement for review', async () => {
    const { processor, queries, extract, download } = harness()
    const outcome = await processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })
    expect(outcome).toEqual({ outcome: 'proposal_stored', extractionId: 'ext-1', uncertainFinancialFields: 1, lineItemsSkipped: 0 })

    expect(download).toHaveBeenCalledWith(COMPANY, statementRow.storage_path)
    expect(extract).toHaveBeenCalledWith(expect.any(Blob), 'october.pdf', {
      companyId: COMPANY,
      statementId: STATEMENT,
      sourceSystem: 'MRI',
      expectedTenantNames: ['Test Trading', 'Test Trading (Pty) Ltd'],
      expectedUnitNumbers: [],
    })

    // Only status and processing_error are ever written to the statement: never verified figures.
    expect(statementUpdates(queries)).toEqual([
      { status: 'processing', processing_error: null },
      { status: 'review_required', processing_error: null },
    ])
    for (const query of queries.filter((q) => q.table === 'statements')) expect(eqValue(query, 'company_id')).toBe(COMPANY)

    const [[extraction, extractionOptions]] = upsertsInto(queries, 'statement_extractions')
    expect(extraction).toMatchObject({ company_id: COMPANY, statement_id: STATEMENT, status: 'pending_review', matched_tenant_id: TENANT })
    expect(extractionOptions).toEqual({ onConflict: 'statement_id', ignoreDuplicates: true })

    const [[fields, fieldOptions]] = upsertsInto(queries, 'statement_extraction_fields')
    expect(fieldOptions).toEqual({ onConflict: 'extraction_id,name', ignoreDuplicates: true, defaultToNull: false })
    expect(fields).toContainEqual(expect.objectContaining({ name: 'payments_received', flagged: true }))
    expect(fields).toContainEqual(expect.objectContaining({ name: 'rental_charged', value: 35000, flagged: false }))

    const [[events]] = upsertsInto(queries, 'monitoring_events')
    expect(events).toEqual([
      expect.objectContaining({ dedupe_key: `statement_review_required:${STATEMENT}`, type: 'statement_review_required', priority: 'high', assigned_to_user_id: MANAGER }),
    ])
    const [[notifications]] = upsertsInto(queries, 'notifications')
    expect(notifications).toEqual([
      expect.objectContaining({ type: 'statement_review', user_id: MANAGER, dedupe_key: `statement_review:${STATEMENT}:${MANAGER}`, link_entity_id: STATEMENT }),
    ])
  })

  it('stores the statement number and opening balance as fields with their confidence', async () => {
    const { processor, queries } = harness()
    await processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })
    const [[fields]] = upsertsInto(queries, 'statement_extraction_fields')
    expect(fields).toContainEqual(expect.objectContaining({ name: 'statement_number', value: 'ST-1042', confidence: 0.96, flagged: false }))
    expect(fields).toContainEqual(expect.objectContaining({ name: 'opening_balance', value: 0, confidence: 0.96, flagged: false }))
  })

  it('flags a typed date, period or number the document disagrees with, keeping the document value', async () => {
    const { processor, queries } = harness({
      statement: { statement_number: 'ST-9999', statement_date: '2026-10-01', period_start: '2026-09-01', period_end: '2026-09-30' },
    })
    await processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })
    const [[fields]] = upsertsInto(queries, 'statement_extraction_fields')
    expect(fields).toContainEqual(expect.objectContaining({ name: 'statement_number', value: 'ST-1042', flagged: true }))
    expect(fields).toContainEqual(expect.objectContaining({ name: 'period_start', value: '2026-10-01', flagged: true }))
    expect(fields).toContainEqual(expect.objectContaining({ name: 'period_end', value: '2026-10-31', flagged: true }))
    expect(fields).toContainEqual(expect.objectContaining({ name: 'statement_date', value: '2026-10-01', flagged: false }))

    const [[extraction]] = upsertsInto(queries, 'statement_extractions')
    expect((extraction as { issues: { code: string; field: string }[] }).issues.filter((i) => i.code === 'typed_value_mismatch').map((i) => i.field)).toEqual([
      'statement_number',
      'period_start',
      'period_end',
    ])
    // The typed values stay on the statement as typed: only status and processing_error are written.
    expect(statementUpdates(queries)).toEqual([
      { status: 'processing', processing_error: null },
      { status: 'review_required', processing_error: null },
    ])
    const [[events]] = upsertsInto(queries, 'monitoring_events')
    expect((events as { description: string }[])[0].description).toContain(
      'The document differs from what was typed at upload: statement number, period start, period end.',
    )
  })

  it('raises the review event and notification BEFORE the statement leaves the processable statuses', async () => {
    const { processor, queries } = harness()
    await processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })
    const reviewRequired = queries.findIndex((q) => isStatusUpdate(q, 'review_required'))
    expect(reviewRequired).toBe(queries.length - 1)
    expect(queries.findIndex((q) => q.table === 'monitoring_events' && isWrite(q))).toBeLessThan(reviewRequired)
    expect(queries.findIndex((q) => q.table === 'notifications' && isWrite(q))).toBeLessThan(reviewRequired)
  })

  it('keeps the statement processable when raising the review fails, so the retry raises it', async () => {
    for (const table of ['monitoring_events', 'notifications']) {
      const { processor, queries } = harness({ respond: failWrites((q) => q.table === table) })
      const error = await rejection(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 }))
      expect(error).not.toBeInstanceOf(UnrecoverableError)
      expect(statementUpdates(queries)).toEqual([{ status: 'processing', processing_error: null }])
    }
    // Same for a statement left for manual entry (non-PDF): no review_required until the outputs exist.
    const manual = harness({ statement: { mime_type: 'image/png' }, respond: failWrites((q) => q.table === 'monitoring_events') })
    const error = await rejection(manual.processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 }))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(manual.queries)).toEqual([{ status: 'processing', processing_error: null }])
  })

  it('leaves the statement reviewable with processing_error when storing the proposal fails on the last attempt', async () => {
    const failures: [string, (query: RecordedQuery) => boolean, () => Promise<DocumentExtractionResult>, RegExp][] = [
      ['extraction', (q) => q.table === 'statement_extractions', async () => goodResult, /Store statement extraction/],
      ['fields', (q) => q.table === 'statement_extraction_fields', async () => goodResult, /Store extracted fields/],
      ['line items', (q) => q.table === 'statement_line_items', async () => withLineItem, /Store proposed statement lines/],
    ]
    for (const [, match, extract, cause] of failures) {
      const { processor, queries } = harness({ statement: { status: 'processing' }, extract, respond: failWrites(match) })
      const error = await rejection(processor.process({ companyId: COMPANY, statementId: STATEMENT }, lastAttempt))
      expect(error).toBeInstanceOf(UnrecoverableError)
      expect(statementUpdates(queries).at(-1)).toEqual({
        status: 'review_required',
        processing_error: expect.stringMatching(new RegExp(`^Automatic extraction failed after 5 attempts: .*${cause.source}`)),
      })
      expect(upsertsInto(queries, 'monitoring_events')[0][0]).toEqual([expect.objectContaining({ priority: 'high', dedupe_key: `statement_review_required:${STATEMENT}` })])
    }
  })

  it('leaves the statement reviewable with processing_error when the final status update fails on the last attempt', async () => {
    const { processor, queries } = harness({
      statement: { status: 'processing' },
      respond: failWrites((q) => isStatusUpdate(q, 'review_required'), 1),
    })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, lastAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(queries).slice(-2)).toEqual([
      { status: 'review_required', processing_error: null },
      { status: 'review_required', processing_error: expect.stringMatching(/^Automatic extraction failed after 5 attempts: Set statement status review_required/) },
    ])
  })

  it('still leaves the statement reviewable on the last attempt when the review event cannot be raised', async () => {
    const { processor, queries } = harness({
      statement: { status: 'processing', mime_type: 'image/png' },
      respond: failWrites((q) => q.table === 'monitoring_events'),
    })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, lastAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(queries).at(-1)).toEqual({ status: 'review_required', processing_error: expect.stringMatching(/Only PDF/) })
  })

  it('skips a statement that was already processed or verified', async () => {
    const { processor, queries, extract } = harness({ statement: { status: 'verified' } })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'statement is already verified',
    })
    expect(extract).not.toHaveBeenCalled()
    expect(queries.filter(isWrite)).toEqual([])
  })

  it('fails permanently on a 4xx and leaves the statement reviewable with the reason', async () => {
    const { processor, queries } = harness({
      extract: async () => {
        throw new DocumentProcessingError('Document processing failed with HTTP 422 (encrypted_pdf): The PDF is password protected.', {
          retryable: false,
          code: 'encrypted_pdf',
          status: 422,
        })
      },
    })
    const error = await rejection(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 }))
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(queries).at(-1)).toEqual({
      status: 'review_required',
      processing_error: 'Document processing failed with HTTP 422 (encrypted_pdf): The PDF is password protected.',
    })
    expect(upsertsInto(queries, 'statement_extractions')).toEqual([])
    expect(upsertsInto(queries, 'monitoring_events')[0][0]).toEqual([expect.objectContaining({ priority: 'high' })])
  })

  it('retries a transient failure without changing the statement, until the last attempt', async () => {
    const unavailable = async (): Promise<DocumentExtractionResult> => {
      throw new DocumentProcessingError('Document processing failed with HTTP 503 (unknown): busy', { retryable: true, code: 'unknown', status: 503 })
    }
    const first = harness({ extract: unavailable })
    const error = await rejection(first.processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 }))
    expect(error).toBeInstanceOf(DocumentProcessingError)
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(first.queries)).toEqual([{ status: 'processing', processing_error: null }])

    const last = harness({ statement: { status: 'processing' }, extract: unavailable })
    const finalError = await rejection(last.processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 5, maxAttempts: 5 }))
    expect(finalError).toBeInstanceOf(UnrecoverableError)
    expect(statementUpdates(last.queries).at(-1)).toMatchObject({
      status: 'review_required',
      processing_error: expect.stringMatching(/^Automatic extraction failed after 5 attempts: .*HTTP 503/),
    })
  })

  it('never sends a non-PDF statement for extraction', async () => {
    const { processor, extract, queries } = harness({ statement: { mime_type: 'image/png' } })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(extract).not.toHaveBeenCalled()
    expect(statementUpdates(queries).at(-1)).toMatchObject({ status: 'review_required', processing_error: expect.stringMatching(/Only PDF/) })
  })

  it('records an unreadable statement for manual entry without storing a proposal', async () => {
    const failed = extractionResult({
      status: 'failed',
      issues: [{ code: 'scanned_without_ocr', severity: 'error', message: 'The PDF has no text layer', field: null }],
    })
    const { processor, queries } = harness({ extract: async () => failed })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })).resolves.toEqual({
      outcome: 'review_without_proposal',
      reason: 'The statement could not be read automatically: The PDF has no text layer',
    })
    expect(upsertsInto(queries, 'statement_extractions')).toEqual([])
    expect(statementUpdates(queries).at(-1)).toMatchObject({ status: 'review_required', processing_error: expect.stringMatching(/no text layer/) })
  })

  it('fails permanently when the result breaks the field contract', async () => {
    const missingField = extractionResult({ fields: goodResult.fields.slice(1) })
    const { processor, queries } = harness({ extract: async () => missingField })
    await expect(processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })).rejects.toThrow(/field "tenant_name" is missing/)
    expect(upsertsInto(queries, 'statement_extractions')).toEqual([])
  })

  it('offers the tenants assigned to the property\'s units without a lease as matching hints', async () => {
    const { processor, queries, extract } = harness({
      statement: { tenant_id: null },
      respond: (query) =>
        query.table === 'unit_tenant_assignments' && !isWrite(query) ? { data: [{ tenant_id: TENANT }], error: null } : undefined,
    })
    await processor.process({ companyId: COMPANY, statementId: STATEMENT }, { attempt: 1, maxAttempts: 5 })

    const assignments = queries.find((q) => q.table === 'unit_tenant_assignments')
    expect(eqValue(assignments!, 'company_id')).toBe(COMPANY)
    expect(eqValue(assignments!, 'property_id')).toBe(PROPERTY)
    expect(callsTo(assignments!, 'is')).toEqual([['ended_at', null]])
    expect(extract).toHaveBeenCalledWith(expect.any(Blob), 'october.pdf', expect.objectContaining({ expectedTenantNames: ['Test Trading', 'Test Trading (Pty) Ltd'] }))
    const [[extraction]] = upsertsInto(queries, 'statement_extractions')
    expect(extraction).toMatchObject({ matched_tenant_id: TENANT })
  })
})
