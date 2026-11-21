import { describe, expect, it } from 'vitest'

import {
  approvalAgeBucket,
  buildCommunicationActivityReport,
  buildStatementProcessingReport,
  deliveryOutcome,
  type CommunicationRecord,
  type StatementReviewFieldRecord,
  type StatementUploadRecord,
} from './statementCommunicationReports.js'

const P1 = 'p-1'
const P2 = 'p-2'

const statement = (over: Partial<StatementUploadRecord> & Pick<StatementUploadRecord, 'statementId' | 'status'>): StatementUploadRecord => ({
  fileName: `${over.statementId}.pdf`,
  propertyId: P1,
  propertyName: 'Maponya Square',
  sourceSystem: 'MRI',
  uploadedAt: '2026-11-10T08:00:00Z',
  uploadedOn: '2026-11-10',
  ...over,
})

const STATEMENTS: StatementUploadRecord[] = [
  statement({ statementId: 's-verified', status: 'verified', extractionConfidence: 0.9, uploadedAt: '2026-11-01T08:00:00Z', uploadedOn: '2026-11-01' }),
  statement({ statementId: 's-review', status: 'review_required', extractionConfidence: 0.6, uploadedAt: '2026-11-05T08:00:00Z', uploadedOn: '2026-11-05' }),
  statement({
    statementId: 's-failed',
    status: 'review_required',
    processingError: 'The PDF could not be read',
    sourceSystem: 'Sage',
    uploadedAt: '2026-11-03T08:00:00Z',
    uploadedOn: '2026-11-03',
  }),
  statement({ statementId: 's-new', status: 'uploaded', propertyId: P2, propertyName: 'Atrium', sourceSystem: 'Sage', uploadedAt: '2026-11-20T08:00:00Z', uploadedOn: '2026-11-20' }),
  statement({ statementId: 's-dup', status: 'duplicate', duplicateOfStatementId: 's-verified', propertyId: P2, propertyName: 'Atrium' }),
]

const FIELDS: StatementReviewFieldRecord[] = [
  { statementId: 's-review', name: 'rental_charged', value: 12000, flagged: true },
  { statementId: 's-review', name: 'tenant_name', value: 'Dlamini Cellular', flagged: false },
  { statementId: 's-review', name: 'statement_date', value: null, flagged: true },
  { statementId: 's-review', name: 'opening_balance', value: 0, flagged: true, confirmedAt: '2026-11-06T08:00:00Z' },
  { statementId: 's-review', name: 'statement_number', value: null, flagged: true, confirmedAt: '2026-11-06T08:00:00Z' },
  { statementId: 's-review', name: 'total_due', value: 1, flagged: true, correctedValue: 2 },
]

describe('buildStatementProcessingReport', () => {
  const report = buildStatementProcessingReport(STATEMENTS, FIELDS, '2026-11-21')

  it('counts the uploads by where they stand; pending review includes processing failures, as the dashboard counts', () => {
    expect(report).toMatchObject({ total: 5, inProgress: 1, pendingReview: 2, processingFailures: 1, awaitingReview: 1, verified: 1, duplicate: 1, rejected: 0 })
    expect(report.countsByStatus).toEqual({ uploaded: 1, processing: 0, review_required: 2, verified: 1, rejected: 0, duplicate: 1 })
  })

  it('groups by source system (in STATEMENT_SOURCES order) and by property (by name)', () => {
    expect(report.bySource.map((group) => [group.sourceSystem, group.total, group.processingFailures])).toEqual([
      ['MRI', 3, 0],
      ['Sage', 2, 1],
    ])
    expect(report.byProperty.map((group) => [group.propertyName, group.total, group.pendingReview])).toEqual([
      ['Atrium', 2, 0],
      ['Maponya Square', 3, 2],
    ])
  })

  it('lists the backlog oldest first with its age and the fields still to resolve (fieldResolution)', () => {
    expect(report.backlog.map((row) => [row.statementId, row.ageDays, row.unresolvedFields, row.processingFailed])).toEqual([
      ['s-failed', 18, 0, true],
      ['s-review', 16, 2, false],
    ])
    expect(report.oldestPendingReviewDays).toBe(18)
    expect(report.failures.map((row) => row.statementId)).toEqual(['s-failed'])
  })

  it('lists every upload newest first and averages the extraction confidence of those with one', () => {
    expect(report.rows[0]?.statementId).toBe('s-new')
    expect(report.averageExtractionConfidence).toBeCloseTo(0.75)
  })

  it('applies the property, status and upload-date filters', () => {
    expect(buildStatementProcessingReport(STATEMENTS, FIELDS, '2026-11-21', { propertyIds: [P2] }).total).toBe(2)
    expect(buildStatementProcessingReport(STATEMENTS, FIELDS, '2026-11-21', { statuses: ['review_required'] }).rows.map((row) => row.statementId)).toEqual([
      's-review',
      's-failed',
    ])
    const ranged = buildStatementProcessingReport(STATEMENTS, FIELDS, '2026-11-21', { from: '2026-11-03', to: '2026-11-05' })
    expect(ranged.rows.map((row) => row.statementId)).toEqual(['s-review', 's-failed'])
  })

  it('answers an empty report without averages or ages', () => {
    const empty = buildStatementProcessingReport([], [], '2026-11-21')
    expect(empty).toMatchObject({ total: 0, averageExtractionConfidence: null, oldestPendingReviewDays: null, backlog: [], bySource: [], byProperty: [] })
  })
})

const NOW = new Date('2026-11-21T10:00:00Z')

const message = (over: Partial<CommunicationRecord> & Pick<CommunicationRecord, 'communicationId' | 'status'>): CommunicationRecord => ({
  createdAt: '2026-11-20T08:00:00Z',
  createdOn: '2026-11-20',
  channel: 'whatsapp',
  direction: 'outbound',
  messageType: 'monthly_statement',
  recipientType: 'tenant',
  tenantId: 't-1',
  counterpartyName: 'Dlamini Cellular',
  propertyId: P1,
  propertyName: 'Maponya Square',
  ...over,
})

const MESSAGES: CommunicationRecord[] = [
  message({
    communicationId: 'm-pending-old',
    status: 'pending_approval',
    messageType: 'overdue_payment_reminder',
    approvalDecision: 'pending',
    approvalRequestedAt: '2026-11-16T10:00:00Z',
    createdAt: '2026-11-16T10:00:00Z',
    createdOn: '2026-11-16',
  }),
  message({ communicationId: 'm-pending-new', status: 'pending_approval', approvalDecision: 'pending', approvalRequestedAt: '2026-11-21T06:00:00Z' }),
  message({
    communicationId: 'm-delivered',
    status: 'delivered',
    approvalDecision: 'approved',
    approvalRequestedAt: '2026-11-19T08:00:00Z',
    approvalDecidedAt: '2026-11-19T09:00:00Z',
  }),
  message({ communicationId: 'm-read', status: 'read', approvalDecision: 'approved', approvalRequestedAt: '2026-11-19T08:00:00Z', approvalDecidedAt: '2026-11-19T08:30:00Z' }),
  message({ communicationId: 'm-failed', status: 'failed', failureReason: 'Number not on WhatsApp', createdAt: '2026-11-21T07:00:00Z', createdOn: '2026-11-21' }),
  message({ communicationId: 'm-queued', status: 'queued' }),
  message({
    communicationId: 'm-rejected',
    status: 'rejected',
    approvalDecision: 'rejected',
    approvalRequestedAt: '2026-11-18T08:00:00Z',
    approvalDecidedAt: '2026-11-18T10:00:00Z',
  }),
  message({ communicationId: 'm-inbound', status: 'received', direction: 'inbound', messageType: 'inbound_reply' }),
  message({
    communicationId: 'm-owner',
    status: 'sent',
    messageType: 'owner_weekly_summary',
    recipientType: 'property_owner',
    tenantId: undefined,
    counterpartyName: 'Pieter Botha',
    propertyId: undefined,
    propertyName: undefined,
  }),
  message({
    communicationId: 'm-agent',
    status: 'sent',
    messageType: 'manual',
    recipientType: 'contact',
    propertyId: undefined,
    propertyName: undefined,
    approvalDecision: 'approved',
    approvalDecidedByAgent: true,
    approvalRequestedAt: '2026-11-15T08:00:00Z',
    approvalDecidedAt: '2026-11-20T08:00:00Z',
  }),
].map((record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as CommunicationRecord)

describe('deliveryOutcome and approvalAgeBucket', () => {
  it('gives an outcome to outbound messages handed over for sending only', () => {
    expect(deliveryOutcome('outbound', 'queued')).toBe('pending')
    expect(deliveryOutcome('outbound', 'sent')).toBe('pending')
    expect(deliveryOutcome('outbound', 'delivered')).toBe('delivered')
    expect(deliveryOutcome('outbound', 'read')).toBe('read')
    expect(deliveryOutcome('outbound', 'failed')).toBe('failed')
    for (const status of ['draft', 'pending_approval', 'approved', 'rejected'] as const) expect(deliveryOutcome('outbound', status)).toBeUndefined()
    expect(deliveryOutcome('inbound', 'received')).toBeUndefined()
  })

  it('buckets a wait in hours', () => {
    expect([0, 23, 24, 71, 72, 167, 168].map(approvalAgeBucket)).toEqual([
      'under_1_day',
      'under_1_day',
      '1_3_days',
      '1_3_days',
      '3_7_days',
      '3_7_days',
      'over_7_days',
    ])
  })
})

describe('buildCommunicationActivityReport', () => {
  const report = buildCommunicationActivityReport(MESSAGES, NOW)

  it('counts the messages, their outcomes and the delivery rate as communication analytics does', () => {
    expect(report).toMatchObject({ total: 10, outbound: 9, inbound: 1, handedOver: 6, delivered: 2, failed: 1, pendingApproval: 2 })
    expect(report.outcomes).toEqual({ pending: 3, delivered: 1, read: 1, failed: 1 })
    expect(report.deliveryRate).toBeCloseTo(2 / 6)
    expect(report.byStatus.pending_approval).toBe(2)
  })

  it('groups by type in MESSAGE_TYPES order and by property, messages without a property last', () => {
    expect(report.byType.map((group) => [group.messageType, group.total])).toEqual([
      ['monthly_statement', 6],
      ['overdue_payment_reminder', 1],
      ['owner_weekly_summary', 1],
      ['inbound_reply', 1],
      ['manual', 1],
    ])
    expect(report.byProperty.map((group) => [group.propertyName, group.total])).toEqual([
      ['Maponya Square', 8],
      [null, 2],
    ])
  })

  it('lists the pending approvals longest waiting first, with their age, and the turnaround of people’s decisions', () => {
    expect(report.pendingApprovals.map((row) => [row.communicationId, row.waitingHours, row.ageBucket])).toEqual([
      ['m-pending-old', 120, '3_7_days'],
      ['m-pending-new', 4, 'under_1_day'],
    ])
    expect(report.approvals).toEqual({
      pending: 2,
      approved: 3,
      rejected: 1,
      // 60, 30 and 120 minutes; the AI agent's own approval is not a person's turnaround.
      averageTurnaroundMinutes: 70,
      oldestPendingHours: 120,
      byAge: [
        { bucket: 'under_1_day', count: 1 },
        { bucket: '1_3_days', count: 0 },
        { bucket: '3_7_days', count: 1 },
        { bucket: 'over_7_days', count: 0 },
      ],
    })
  })

  it('lists the failed messages and every message newest first', () => {
    expect(report.failedMessages.map((row) => [row.communicationId, row.failureReason])).toEqual([['m-failed', 'Number not on WhatsApp']])
    expect(report.rows[0]?.communicationId).toBe('m-failed')
    expect(report.rows.every((row) => !('approvalDecidedByAgent' in row))).toBe(true)
  })

  it('applies the property filter (leaving out messages without a property), the status filter and the date range', () => {
    expect(buildCommunicationActivityReport(MESSAGES, NOW, { propertyIds: [P1] }).total).toBe(8)
    expect(buildCommunicationActivityReport(MESSAGES, NOW, { propertyIds: [P2] }).total).toBe(0)
    expect(buildCommunicationActivityReport(MESSAGES, NOW, { statuses: ['failed', 'rejected'] }).total).toBe(2)
    const ranged = buildCommunicationActivityReport(MESSAGES, NOW, { from: '2026-11-16', to: '2026-11-16' })
    expect(ranged.rows.map((row) => row.communicationId)).toEqual(['m-pending-old'])
  })

  it('answers an empty report without rates or ages', () => {
    const empty = buildCommunicationActivityReport([], NOW)
    expect(empty).toMatchObject({ total: 0, deliveryRate: null, pendingApprovals: [], failedMessages: [] })
    expect(empty.approvals).toMatchObject({ pending: 0, averageTurnaroundMinutes: null, oldestPendingHours: null })
  })
})
