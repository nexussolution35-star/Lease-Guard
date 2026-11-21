import { OCCUPANCY_STATUSES } from '../types/unit.js'
import { ARRANGEMENT_STATUSES } from '../types/arrangement.js'
import { MONITORING_EVENT_STATUSES } from '../types/monitoring.js'
import { PROPERTY_STATUSES } from '../types/property.js'
import { ARREARS_ARRANGEMENT_STATES, RENTAL_COMPARISON_STATES, type ReportFilters, type ReportFilterSupport, type ReportId } from '../types/reports.js'
import { EXPIRY_BUCKETS, RENEWAL_DEADLINE_ROW_STATUSES } from '../types/reports.js'
import { compareISODate, isValidISODate } from './dates.js'
import type { GuaranteeExpiryState } from './guarantee.js'
import { DELIVERY_STATUSES } from '../types/communication.js'
import { STATEMENT_STATUSES } from '../types/statement.js'

/** The deposits and guarantees report's status filter, in display order: a guarantee's expiry state. */
const GUARANTEE_FILTER_STATES = ['active', 'expiring', 'expired', 'released', 'called'] as const satisfies readonly GuaranteeExpiryState[]

/**
 * The filters each report offers in the shared report frame (PRD §7, §12.9). Every report can be narrowed to
 * properties; the date range bounds the report's primary date field and the status filter its primary record. The
 * ticket that builds a report sets its entry; a report not built yet offers the property filter only.
 */
export const REPORT_FILTER_SUPPORT: Readonly<Record<ReportId, ReportFilterSupport>> = {
  // A snapshot of the portfolio as at today: no date range. The status is the property's.
  portfolio_overview: { property: true, dateRange: null, statuses: { label: 'Property status', values: PROPERTY_STATUSES } },
  // A snapshot of the units as at today: no date range. The status is the unit's occupancy.
  occupancy: { property: true, dateRange: null, statuses: { label: 'Occupancy', values: OCCUPANCY_STATUSES } },
  // Events identified in the range. Without a status filter the report lists the open events (OPEN_EVENT_STATUSES).
  lease_monitoring: { property: true, dateRange: { field: 'Identified' }, statuses: { label: 'Event status', values: MONITORING_EVENT_STATUSES } },
  // Comparisons of statements whose billed period starts in the range. The status is the comparison's outcome.
  rental_discrepancies: { property: true, dateRange: { field: 'Billing period' }, statuses: { label: 'Comparison', values: RENTAL_COMPARISON_STATES } },
  // Monitored leases expiring in the range. The status is where the expiry falls (expired, 0–3, 3–6, 6–12 months, later).
  lease_expiry: { property: true, dateRange: { field: 'Expiry date' }, statuses: { label: 'Expiry', values: EXPIRY_BUCKETS } },
  // Renewal notice deadlines in the range. The status is the deadline's urgency (or exercised).
  renewal_deadlines: { property: true, dateRange: { field: 'Notice deadline' }, statuses: { label: 'Deadline', values: RENEWAL_DEADLINE_ROW_STATUSES } },
  // A snapshot as at today. The date range bounds the guarantee's expiry date; the status is the guarantee's expiry
  // state (rules/guarantee.ts). Either filter leaves out leases without a guarantee.
  deposits_guarantees: { property: true, dateRange: { field: 'Guarantee expiry' }, statuses: { label: 'Guarantee', values: GUARANTEE_FILTER_STATES } },
  // A snapshot of the balances as at today: no date range. The status is whether an active arrangement is in force.
  arrears: { property: true, dateRange: null, statuses: { label: 'Arrangement', values: ARREARS_ARRANGEMENT_STATES } },
  // The date range bounds the date the arrangement was agreed; the status is the arrangement's.
  payment_arrangements: { property: true, dateRange: { field: 'Agreed on' }, statuses: { label: 'Arrangement status', values: ARRANGEMENT_STATUSES } },
  // Statements uploaded in the range (South African date). The status is the statement's.
  statement_processing: { property: true, dateRange: { field: 'Uploaded' }, statuses: { label: 'Statement status', values: STATEMENT_STATUSES } },
  // Messages recorded in the range (South African date). The status is the message's delivery status. The property
  // filter leaves out messages with no property (an owner's weekly summary covers the portfolio).
  communication_activity: { property: true, dateRange: { field: 'Message date' }, statuses: { label: 'Message status', values: DELIVERY_STATUSES } },
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)]

/**
 * Why `filters` cannot be applied to the report, one message per problem (empty when they can): a status the report
 * does not offer, a malformed date, or a range that ends before it starts. Filters the report does not offer at all
 * are not problems; `appliedReportFilters` leaves them out.
 */
export function reportFilterProblems(id: ReportId, filters: ReportFilters): string[] {
  const support = REPORT_FILTER_SUPPORT[id]
  const problems: string[] = []
  if (support.statuses && filters.statuses) {
    const offered = support.statuses.values
    for (const status of unique(filters.statuses)) {
      if (!offered.includes(status)) problems.push(`status: "${status}" is not offered by this report (${support.statuses.label}: ${offered.join(', ')})`)
    }
  }
  if (support.dateRange) {
    for (const key of ['from', 'to'] as const) {
      const value = filters[key]
      if (value !== undefined && !isValidISODate(value)) problems.push(`${key}: must be a date (YYYY-MM-DD)`)
    }
    if (filters.from && filters.to && isValidISODate(filters.from) && isValidISODate(filters.to) && compareISODate(filters.from, filters.to) > 0) {
      problems.push('to: the date range ends before it starts')
    }
  }
  return problems
}

/**
 * The filters the report applies, as the report states them back: only the filters it offers, each list without
 * repeats and empty lists left out. Call after `reportFilterProblems` found none.
 */
export function appliedReportFilters(id: ReportId, filters: ReportFilters): ReportFilters {
  const support = REPORT_FILTER_SUPPORT[id]
  const applied: ReportFilters = {}
  if (support.property && filters.propertyIds && filters.propertyIds.length > 0) applied.propertyIds = unique(filters.propertyIds)
  if (support.dateRange) {
    if (filters.from) applied.from = filters.from
    if (filters.to) applied.to = filters.to
  }
  if (support.statuses && filters.statuses && filters.statuses.length > 0) applied.statuses = unique(filters.statuses)
  return applied
}

/** Whether a record of `propertyId` passes the property filter (no filter: every property). */
export function inReportProperties(filters: ReportFilters, propertyId: string): boolean {
  return !filters.propertyIds || filters.propertyIds.length === 0 || filters.propertyIds.includes(propertyId)
}

/** Whether a record with `status` passes the status filter (no filter: every status). */
export function inReportStatuses(filters: ReportFilters, status: string): boolean {
  return !filters.statuses || filters.statuses.length === 0 || filters.statuses.includes(status)
}
