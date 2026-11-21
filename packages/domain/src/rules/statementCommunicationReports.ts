import type { EntityId, ISODate, ISODateTime } from '../types/common.js'
import {
  DELIVERY_STATUSES,
  MESSAGE_TYPES,
  type ApprovalDecision,
  type Channel,
  type DeliveryStatus,
  type MessageDirection,
  type MessageType,
  type RecipientType,
} from '../types/communication.js'
import {
  APPROVAL_AGE_BUCKETS,
  DELIVERY_OUTCOMES,
  type ApprovalAgeBucket,
  type CommunicationActivityReport,
  type CommunicationActivityRow,
  type CommunicationGroupFigures,
  type DeliveryOutcome,
  type PendingApprovalRow,
  type ReportFilters,
  type StatementGroupFigures,
  type StatementProcessingReport,
  type StatementUploadRow,
} from '../types/reports.js'
import { STATEMENT_SOURCES, STATEMENT_STATUSES, type ExtractionFieldName, type StatementSource, type StatementStatus } from '../types/statement.js'
import { compareISODate, daysBetween } from './dates.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'
import { processingFailed } from './statementProcessing.js'
import { fieldResolution } from './statementReview.js'

/**
 * The statement processing and communication activity reports (ticket R-06, PRD §7, §12.9), put together from the
 * rows the database returns (supabase/migrations/*_reports_statements_communications.sql) with the rules the
 * Statements page, the review screen, the dashboard and communication analytics use: a statement waits for review
 * while its status is `review_required` (the dashboard's pending statement reviews), its processing failed when it
 * waits with a processing error (`processingFailed`), a field is unresolved by `fieldResolution`; a message is handed
 * over when queued, sent, delivered, read or failed, delivered counts read ones too, and a message waits for approval
 * while its approval request is pending (the dashboard's pending approvals). Pure: the caller supplies the rows and
 * the moment the report is as at. A monitoring report: nothing here sends, approves or pays anything.
 */

// ------------------------------------------------------------------------------------------------ shared

/** Whether a record dated `on` falls inside the report's date range (both ends inclusive; no range: every date). */
function inReportRange(filters: ReportFilters, on: ISODate): boolean {
  if (filters.from && compareISODate(on, filters.from) < 0) return false
  if (filters.to && compareISODate(on, filters.to) > 0) return false
  return true
}

const countOf = <T>(rows: readonly T[], test: (row: T) => boolean): number => rows.reduce((total, row) => total + (test(row) ? 1 : 0), 0)

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const group = groups.get(k)
    if (group) group.push(row)
    else groups.set(k, [row])
  }
  return groups
}

const byName = (a: string | null, b: string | null): number => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b, 'en-ZA'))

// ------------------------------------------------------------------------------------------------ statements

/** One uploaded statement, as `reports_statement_uploads` returns it. */
export interface StatementUploadRecord {
  statementId: EntityId
  fileName: string
  statementNumber?: string
  propertyId: EntityId
  propertyName: string
  tenantId?: EntityId
  tenantName?: string
  unitId?: EntityId
  unitNumber?: string
  sourceSystem: StatementSource
  status: StatementStatus
  uploadedAt: ISODateTime
  uploadedOn: ISODate
  statementDate?: ISODate
  processingError?: string
  duplicateOfStatementId?: EntityId
  extractionConfidence?: number
}

/** One extracted field of a statement under review, as `reports_statement_review_fields` returns it. */
export interface StatementReviewFieldRecord {
  statementId: EntityId
  name: ExtractionFieldName
  value: string | number | null
  flagged: boolean
  correctedValue?: string | number
  confirmedAt?: ISODateTime
}

/** Uploads of a group by where they stand. */
export function statementGroupFigures(rows: readonly Pick<StatementUploadRow, 'status' | 'processingFailed'>[]): StatementGroupFigures {
  return {
    total: rows.length,
    inProgress: countOf(rows, (row) => row.status === 'uploaded' || row.status === 'processing'),
    pendingReview: countOf(rows, (row) => row.status === 'review_required'),
    processingFailures: countOf(rows, (row) => row.processingFailed),
    verified: countOf(rows, (row) => row.status === 'verified'),
    rejected: countOf(rows, (row) => row.status === 'rejected'),
    duplicate: countOf(rows, (row) => row.status === 'duplicate'),
  }
}

/** Oldest upload first, then by file name. */
const oldestFirst = (a: StatementUploadRow, b: StatementUploadRow) => a.uploadedAt.localeCompare(b.uploadedAt) || a.fileName.localeCompare(b.fileName)

/**
 * Statement processing: the uploads of the filtered properties, statuses and upload dates (South African), by status,
 * source system and property, with the review backlog (oldest first, with how many fields each still needs) and the
 * statements whose automatic processing failed. With no filters, the pending reviews equal the dashboard's.
 */
export function buildStatementProcessingReport(
  statements: readonly StatementUploadRecord[],
  reviewFields: readonly StatementReviewFieldRecord[],
  asOf: ISODate,
  filters: ReportFilters = {},
): StatementProcessingReport {
  const unresolved = new Map<EntityId, number>()
  for (const field of reviewFields) {
    if (fieldResolution(field) === 'unresolved') unresolved.set(field.statementId, (unresolved.get(field.statementId) ?? 0) + 1)
  }

  const rows: StatementUploadRow[] = statements
    .filter((record) => inReportProperties(filters, record.propertyId) && inReportStatuses(filters, record.status) && inReportRange(filters, record.uploadedOn))
    .map((record) => ({
      ...record,
      processingFailed: processingFailed(record),
      unresolvedFields: record.status === 'review_required' ? (unresolved.get(record.statementId) ?? 0) : 0,
      ageDays: Math.max(0, daysBetween(record.uploadedOn, asOf)),
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.fileName.localeCompare(b.fileName))

  const backlog = rows.filter((row) => row.status === 'review_required').sort(oldestFirst)
  const confidences = rows.flatMap((row) => (row.extractionConfidence === undefined ? [] : [row.extractionConfidence]))
  const figures = statementGroupFigures(rows)

  const bySource = groupBy(rows, (row) => row.sourceSystem)
  const byProperty = groupBy(rows, (row) => row.propertyId)

  return {
    ...figures,
    countsByStatus: Object.fromEntries(STATEMENT_STATUSES.map((status) => [status, countOf(rows, (row) => row.status === status)])) as Record<StatementStatus, number>,
    bySource: STATEMENT_SOURCES.flatMap((sourceSystem) => {
      const group = bySource.get(sourceSystem)
      return group ? [{ sourceSystem, ...statementGroupFigures(group) }] : []
    }),
    byProperty: [...byProperty]
      .map(([propertyId, group]) => ({ propertyId, propertyName: group[0]?.propertyName ?? '', ...statementGroupFigures(group) }))
      .sort((a, b) => byName(a.propertyName, b.propertyName) || a.propertyId.localeCompare(b.propertyId)),
    awaitingReview: figures.pendingReview - figures.processingFailures,
    oldestPendingReviewDays: backlog[0]?.ageDays ?? null,
    averageExtractionConfidence: confidences.length > 0 ? confidences.reduce((total, value) => total + value, 0) / confidences.length : null,
    backlog,
    failures: backlog.filter((row) => row.processingFailed),
    rows,
  }
}

// ------------------------------------------------------------------------------------------------ communications

/** One message, as `reports_communication_activity` returns it, with its approval (pending, else latest decided). */
export interface CommunicationRecord {
  communicationId: EntityId
  createdAt: ISODateTime
  createdOn: ISODate
  channel: Channel
  direction: MessageDirection
  messageType: MessageType
  recipientType: RecipientType
  counterpartyName?: string
  tenantId?: EntityId
  propertyId?: EntityId
  propertyName?: string
  statementId?: EntityId
  arrangementId?: EntityId
  status: DeliveryStatus
  failureReason?: string
  approvalDecision?: ApprovalDecision
  approvalRequestedAt?: ISODateTime
  approvalDecidedAt?: ISODateTime
  /** The AI agent approved its own reply to a contact under the company's auto-reply (never a tenant message). */
  approvalDecidedByAgent?: boolean
}

/** Delivery statuses of a message handed to WhatsApp for sending (as communication analytics counts outbound). */
const HANDED_OVER: readonly DeliveryStatus[] = ['queued', 'sent', 'delivered', 'read', 'failed']

/** What became of an outbound message handed over for sending; undefined for any other message. */
export function deliveryOutcome(direction: MessageDirection, status: DeliveryStatus): DeliveryOutcome | undefined {
  if (direction !== 'outbound' || !HANDED_OVER.includes(status)) return undefined
  if (status === 'queued' || status === 'sent') return 'pending'
  return status as Exclude<DeliveryOutcome, 'pending'>
}

const HOUR_MS = 3_600_000

/** Where a wait of `hours` falls: under a day, 1–3 days, 3–7 days, more than 7 days. */
export function approvalAgeBucket(hours: number): ApprovalAgeBucket {
  if (hours < 24) return 'under_1_day'
  if (hours < 72) return '1_3_days'
  if (hours < 168) return '3_7_days'
  return 'over_7_days'
}

/** Whole hours from `from` to `now` (never negative). */
function hoursSince(from: ISODateTime, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / HOUR_MS))
}

/** Messages of a group. */
export function communicationGroupFigures(rows: readonly CommunicationActivityRow[]): CommunicationGroupFigures {
  return {
    total: rows.length,
    outbound: countOf(rows, (row) => row.direction === 'outbound'),
    inbound: countOf(rows, (row) => row.direction === 'inbound'),
    handedOver: countOf(rows, (row) => row.outcome !== undefined),
    delivered: countOf(rows, (row) => row.outcome === 'delivered' || row.outcome === 'read'),
    failed: countOf(rows, (row) => row.outcome === 'failed'),
    pendingApproval: countOf(rows, (row) => row.approvalDecision === 'pending'),
  }
}

/**
 * Communication activity: the messages of the filtered properties, delivery statuses and dates (South African), by
 * type, status, delivery outcome and property, with the approvals still pending and how long each has waited (as at
 * `now`), the approval turnaround of decided requests (people only: the AI agent's own approvals are instant) and the
 * failed messages. With no filters, the pending approvals equal the dashboard's.
 */
export function buildCommunicationActivityReport(
  records: readonly CommunicationRecord[],
  now: Date,
  filters: ReportFilters = {},
): CommunicationActivityReport {
  const shown = records.filter(
    (record) =>
      (!filters.propertyIds || filters.propertyIds.length === 0 || (record.propertyId !== undefined && inReportProperties(filters, record.propertyId))) &&
      inReportStatuses(filters, record.status) &&
      inReportRange(filters, record.createdOn),
  )
  const rows: CommunicationActivityRow[] = shown
    .map((record): CommunicationActivityRow => {
      const { approvalDecidedByAgent: _agent, ...row } = record
      const outcome = deliveryOutcome(record.direction, record.status)
      return outcome ? { ...row, outcome } : row
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.communicationId.localeCompare(b.communicationId))

  const pendingApprovals: PendingApprovalRow[] = rows
    .flatMap((row) => {
      if (row.approvalDecision !== 'pending' || !row.approvalRequestedAt) return []
      const waitingHours = hoursSince(row.approvalRequestedAt, now)
      return [{ ...row, approvalRequestedAt: row.approvalRequestedAt, waitingHours, ageBucket: approvalAgeBucket(waitingHours) }]
    })
    .sort((a, b) => a.approvalRequestedAt.localeCompare(b.approvalRequestedAt) || a.communicationId.localeCompare(b.communicationId))

  const turnarounds = shown.flatMap((record) =>
    (record.approvalDecision === 'approved' || record.approvalDecision === 'rejected') &&
    !record.approvalDecidedByAgent &&
    record.approvalRequestedAt &&
    record.approvalDecidedAt
      ? [Math.max(0, (Date.parse(record.approvalDecidedAt) - Date.parse(record.approvalRequestedAt)) / 60_000)]
      : [],
  )

  const byType = groupBy(rows, (row) => row.messageType)
  const byProperty = groupBy(rows, (row) => row.propertyId ?? null)

  return {
    ...communicationGroupFigures(rows),
    byType: MESSAGE_TYPES.flatMap((messageType) => {
      const group = byType.get(messageType)
      return group ? [{ messageType, ...communicationGroupFigures(group) }] : []
    }),
    byStatus: Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, countOf(rows, (row) => row.status === status)])) as Record<DeliveryStatus, number>,
    byProperty: [...byProperty]
      .map(([propertyId, group]) => ({ propertyId, propertyName: group[0]?.propertyName ?? null, ...communicationGroupFigures(group) }))
      .sort((a, b) => byName(a.propertyName, b.propertyName) || (a.propertyId ?? '').localeCompare(b.propertyId ?? '')),
    outcomes: Object.fromEntries(DELIVERY_OUTCOMES.map((outcome) => [outcome, countOf(rows, (row) => row.outcome === outcome)])) as Record<DeliveryOutcome, number>,
    deliveryRate: (() => {
      const handedOver = countOf(rows, (row) => row.outcome !== undefined)
      return handedOver > 0 ? countOf(rows, (row) => row.outcome === 'delivered' || row.outcome === 'read') / handedOver : null
    })(),
    approvals: {
      pending: pendingApprovals.length,
      approved: countOf(rows, (row) => row.approvalDecision === 'approved'),
      rejected: countOf(rows, (row) => row.approvalDecision === 'rejected'),
      averageTurnaroundMinutes: turnarounds.length > 0 ? Math.round(turnarounds.reduce((total, value) => total + value, 0) / turnarounds.length) : null,
      oldestPendingHours: pendingApprovals[0]?.waitingHours ?? null,
      byAge: APPROVAL_AGE_BUCKETS.map((bucket) => ({ bucket, count: countOf(pendingApprovals, (row) => row.ageBucket === bucket) })),
    },
    pendingApprovals,
    failedMessages: rows.filter((row) => row.outcome === 'failed'),
    rows,
  }
}
