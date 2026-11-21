import { OCCUPANCY_STATUSES } from '../types/unit.js'
import { PROPERTY_STATUSES } from '../types/property.js'
import type { ReportFilters, ReportFilterSupport, ReportId } from '../types/reports.js'
import { compareISODate, isValidISODate } from './dates.js'

const PROPERTY_ONLY: ReportFilterSupport = { property: true, dateRange: null, statuses: null }

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
  lease_monitoring: PROPERTY_ONLY,
  rental_discrepancies: PROPERTY_ONLY,
  lease_expiry: PROPERTY_ONLY,
  renewal_deadlines: PROPERTY_ONLY,
  deposits_guarantees: PROPERTY_ONLY,
  arrears: PROPERTY_ONLY,
  payment_arrangements: PROPERTY_ONLY,
  statement_processing: PROPERTY_ONLY,
  communication_activity: PROPERTY_ONLY,
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
