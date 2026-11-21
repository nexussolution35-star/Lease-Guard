import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { ReportDataService } from './report-data.service'
import { StatementCommunicationReportDataService } from './statement-communication-report-data.service'
import { StatementCommunicationReportsService } from './statement-communication-reports.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
const PROPERTY = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e'
// 10:00 in Johannesburg on 21 November 2026.
const NOW = new Date('2026-11-21T08:00:00Z')

const STATEMENT_ROWS = [
  {
    statement_id: 's1',
    file_name: 'MSQ-2026-10.pdf',
    statement_number: null,
    property_id: PROPERTY,
    property_name: 'Maponya Square',
    tenant_id: 't1',
    tenant_name: 'Dlamini Cellular',
    unit_id: 'u1',
    unit_number: 'S01',
    source_system: 'MRI',
    status: 'review_required',
    uploaded_at: '2026-11-11T09:00:00+00:00',
    uploaded_on: '2026-11-11',
    statement_date: '2026-10-31',
    processing_error: null,
    duplicate_of_statement_id: null,
    extraction_confidence: '0.620',
  },
  {
    statement_id: 's2',
    file_name: 'unreadable.pdf',
    statement_number: null,
    property_id: PROPERTY,
    property_name: 'Maponya Square',
    tenant_id: null,
    tenant_name: null,
    unit_id: null,
    unit_number: null,
    source_system: 'PropSys',
    status: 'review_required',
    uploaded_at: '2026-11-20T08:00:00+00:00',
    uploaded_on: '2026-11-20',
    statement_date: null,
    processing_error: 'The PDF could not be read',
    duplicate_of_statement_id: null,
    extraction_confidence: null,
  },
]

const FIELD_ROWS = [
  { statement_id: 's1', name: 'rental_charged', value: 12000, flagged: true, corrected_value: null, confirmed_at: null },
  { statement_id: 's1', name: 'total_due', value: 12000, flagged: true, corrected_value: 13000, confirmed_at: null },
]

const MESSAGE_ROWS = [
  {
    communication_id: 'm1',
    created_at: '2026-11-19T08:00:00+00:00',
    created_on: '2026-11-19',
    channel: 'whatsapp',
    direction: 'outbound',
    message_type: 'overdue_payment_reminder',
    recipient_type: 'tenant',
    counterparty_name: 'Dlamini Cellular',
    tenant_id: 't1',
    property_id: PROPERTY,
    property_name: 'Maponya Square',
    statement_id: null,
    arrangement_id: null,
    status: 'pending_approval',
    failure_reason: null,
    approval_decision: 'pending',
    approval_requested_at: '2026-11-19T08:00:00+00:00',
    approval_decided_at: null,
    approval_decided_by_agent: false,
  },
  {
    communication_id: 'm2',
    created_at: '2026-11-20T08:00:00+00:00',
    created_on: '2026-11-20',
    channel: 'whatsapp',
    direction: 'outbound',
    message_type: 'owner_weekly_summary',
    recipient_type: 'property_owner',
    counterparty_name: 'Pieter Botha',
    tenant_id: null,
    property_id: null,
    property_name: null,
    statement_id: null,
    arrangement_id: null,
    status: 'failed',
    failure_reason: 'Number not on WhatsApp',
    approval_decision: null,
    approval_requested_at: null,
    approval_decided_at: null,
    approval_decided_by_agent: null,
  },
]

function dbAnswering(results: Record<string, { data: unknown; error: { code: string; message: string } | null }>) {
  const calls: { fn: string; args: unknown }[] = []
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return results[fn] ?? { data: [], error: null }
    },
  } as unknown as DbClient
  return { db, calls }
}

const service = new StatementCommunicationReportsService(new StatementCommunicationReportDataService(new ReportDataService()))

describe('StatementCommunicationReportsService', () => {
  it('builds the statement processing report from the reporting functions, as at the South African date', async () => {
    const { db, calls } = dbAnswering({
      reports_statement_uploads: { data: STATEMENT_ROWS, error: null },
      reports_statement_review_fields: { data: FIELD_ROWS, error: null },
    })
    const envelope = await service.statementProcessing(db, COMPANY, {}, NOW)
    expect(calls.map((call) => call.fn).sort()).toEqual(['reports_statement_review_fields', 'reports_statement_uploads'])
    expect(calls.every((call) => (call.args as { p_company_id: string }).p_company_id === COMPANY)).toBe(true)
    expect(envelope).toMatchObject({ reportId: 'statement_processing', asOf: '2026-11-21', filters: {} })
    expect(envelope.data).toMatchObject({ total: 2, pendingReview: 2, processingFailures: 1, awaitingReview: 1, oldestPendingReviewDays: 10 })
    expect(envelope.data.backlog.map((row) => [row.statementId, row.unresolvedFields])).toEqual([
      ['s1', 1],
      ['s2', 0],
    ])
    expect(envelope.data.rows[0]).not.toHaveProperty('statementNumber')
    expect(envelope.data.averageExtractionConfidence).toBeCloseTo(0.62)
  })

  it('applies and states back the filters it offers', async () => {
    const { db } = dbAnswering({ reports_statement_uploads: { data: STATEMENT_ROWS, error: null } })
    const envelope = await service.statementProcessing(db, COMPANY, { from: '2026-11-15', status: ['review_required'] }, NOW)
    expect(envelope.filters).toEqual({ from: '2026-11-15', statuses: ['review_required'] })
    expect(envelope.data.rows.map((row) => row.statementId)).toEqual(['s2'])
  })

  it('refuses (400) a status the report does not offer and a range that ends before it starts', async () => {
    const { db } = dbAnswering({})
    await expect(service.statementProcessing(db, COMPANY, { status: ['delivered'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.communicationActivity(db, COMPANY, { from: '2026-11-20', to: '2026-11-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('builds the communication activity report with the approval age as at now', async () => {
    const { db } = dbAnswering({ reports_communication_activity: { data: MESSAGE_ROWS, error: null } })
    const envelope = await service.communicationActivity(db, COMPANY, {}, NOW)
    expect(envelope).toMatchObject({ reportId: 'communication_activity', asOf: '2026-11-21' })
    expect(envelope.data).toMatchObject({ total: 2, handedOver: 1, failed: 1, pendingApproval: 1, deliveryRate: 0 })
    expect(envelope.data.pendingApprovals.map((row) => [row.communicationId, row.waitingHours, row.ageBucket])).toEqual([['m1', 48, '1_3_days']])
    expect(envelope.data.failedMessages.map((row) => [row.counterpartyName, row.failureReason])).toEqual([['Pieter Botha', 'Number not on WhatsApp']])
    expect(envelope.data.byProperty.map((group) => group.propertyName)).toEqual(['Maponya Square', null])
  })

  it('answers 403 when the database refuses the company (42501)', async () => {
    const { db } = dbAnswering({ reports_communication_activity: { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } } })
    await expect(service.communicationActivity(db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('fails loudly on rows of an unexpected shape rather than reporting wrong figures', async () => {
    const { db } = dbAnswering({ reports_communication_activity: { data: [{ ...MESSAGE_ROWS[0], status: 'lost' }], error: null } })
    await expect(service.communicationActivity(db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
