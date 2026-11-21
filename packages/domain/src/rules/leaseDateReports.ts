import type { EntityId, ISODate, ZAR } from '../types/common.js'
import type { LeaseStatus, RenewalOption } from '../types/lease.js'
import {
  EXPIRY_BUCKETS,
  RENEWAL_DEADLINE_ROW_STATUSES,
  type ExpiryBucket,
  type LeaseExpiryReport,
  type LeaseExpiryRow,
  type RenewalDeadlineRow,
  type RenewalDeadlineRowStatus,
  type RenewalDeadlinesReport,
  type ReportFilters,
} from '../types/reports.js'
import { addMonthsISO, compareISODate, daysBetween } from './dates.js'
import { daysUntilExpiry, MONITORED_LEASE_STATUSES, shouldRaiseExpiryEvent } from './leaseExpiry.js'
import { roundZar, sumZar } from './money.js'
import { leasesRequiringRenewalWarning, renewalDeadlineStatus, renewalNoticeDeadline } from './renewalNotice.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'

/**
 * The lease expiry and renewal deadline reports (ticket R-03, PRD §4.1, §7, §12.9), put together from the leases the
 * database returns (supabase/migrations/*_reports_lease_dates.sql) with the rules monitoring uses
 * (backend/src/workers/monitoring/lease-monitoring.findings.ts): only VERIFIED leases in a monitored status (active,
 * expiring) are reported, since unverified terms never drive monitoring; days and deadlines come from
 * `daysUntilExpiry` and `renewalNoticeDeadline`; a lease is "within notice" exactly when monitoring would raise its
 * expiry (`shouldRaiseExpiryEvent`) or renewal (`leasesRequiringRenewalWarning`) event with the company's thresholds.
 * Pure: the caller supplies the rows and the "as at" date.
 */

/** Statuses of a lease that has ended: an unverified lease in one of them is not waiting for verification. */
const ENDED_LEASE_STATUSES: readonly LeaseStatus[] = ['expired', 'renewed', 'terminated']

/** One lease, as `reports_lease_dates` returns it (leases that have ended are not returned). */
export interface LeaseDateRecord {
  leaseId: EntityId
  reference: string
  status: LeaseStatus
  verified: boolean
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId: EntityId
  unitNumber: string
  expiryDate: ISODate
  currentMonthlyRental: ZAR
  renewalOption: Pick<RenewalOption, 'exists' | 'exercised' | 'noticePeriodMonths'>
  /** The lease's open lease-expiry monitoring event, if any. */
  openExpiryEventId?: EntityId
  /** The lease's open renewal-notice-deadline monitoring event, if any. */
  openRenewalEventId?: EntityId
}

/**
 * The company's monitoring thresholds for lease dates, as monitoring applies them: the rule's own days, else the
 * company's settings; `null` when the company switched the rule off (monitoring raises no event then).
 */
export interface LeaseDateMonitoringSettings {
  leaseExpiryNoticeDays: readonly number[] | null
  renewalWarningDays: readonly number[] | null
}

/** Thresholds as the report states them: whole positive days, without repeats, largest first. */
function thresholds(days: readonly number[] | null): number[] {
  return [...new Set((days ?? []).filter((day) => Number.isInteger(day) && day > 0))].sort((a, b) => b - a)
}

/** Whether a lease is monitored: verified terms in a monitored status. */
const isMonitored = (lease: LeaseDateRecord) => lease.verified && MONITORED_LEASE_STATUSES.includes(lease.status)

/** Leases that have not ended whose terms are not verified yet, at the filtered properties. */
function unverifiedCount(leases: readonly LeaseDateRecord[], filters: ReportFilters): number {
  return leases.filter((lease) => !lease.verified && !ENDED_LEASE_STATUSES.includes(lease.status) && inReportProperties(filters, lease.propertyId)).length
}

/** Whether `date` is inside the report's inclusive date range (no range: every date). */
function inDateRange(filters: ReportFilters, date: ISODate): boolean {
  if (filters.from && compareISODate(date, filters.from) < 0) return false
  if (filters.to && compareISODate(date, filters.to) > 0) return false
  return true
}

/**
 * Where an expiry date falls from `asOf`, in calendar months (end of each bucket inclusive, a month clamped to the
 * target month's last day as `addMonthsISO`): before `asOf` expired; up to 3 months on; 3–6; 6–12; later.
 */
export function expiryBucketFor(expiryDate: ISODate, asOf: ISODate): ExpiryBucket {
  if (compareISODate(expiryDate, asOf) < 0) return 'expired'
  if (compareISODate(expiryDate, addMonthsISO(asOf, 3)) <= 0) return 'months_0_3'
  if (compareISODate(expiryDate, addMonthsISO(asOf, 6)) <= 0) return 'months_3_6'
  if (compareISODate(expiryDate, addMonthsISO(asOf, 12)) <= 0) return 'months_6_12'
  return 'later'
}

const byDateThenReference = <T extends { reference: string }>(date: (row: T) => ISODate) => (a: T, b: T) =>
  compareISODate(date(a), date(b)) || a.reference.localeCompare(b.reference)

/**
 * The lease expiry report on `asOf`: every monitored lease at the filtered properties whose expiry date is in the
 * date range and whose bucket is in the status filter, soonest first, with the bucket totals (every bucket, in
 * EXPIRY_BUCKETS order) of the leases shown.
 */
export function buildLeaseExpiryReport(
  leases: readonly LeaseDateRecord[],
  settings: LeaseDateMonitoringSettings,
  asOf: ISODate,
  filters: ReportFilters = {},
): LeaseExpiryReport {
  const noticeDays = thresholds(settings.leaseExpiryNoticeDays)
  const rows = leases
    .filter((lease) => isMonitored(lease) && inReportProperties(filters, lease.propertyId) && inDateRange(filters, lease.expiryDate))
    .map((lease): LeaseExpiryRow => {
      const threshold = settings.leaseExpiryNoticeDays === null ? null : shouldRaiseExpiryEvent(lease, asOf, noticeDays)
      return {
        leaseId: lease.leaseId,
        reference: lease.reference,
        tenantId: lease.tenantId,
        tenantName: lease.tenantName,
        propertyId: lease.propertyId,
        propertyName: lease.propertyName,
        unitId: lease.unitId,
        unitNumber: lease.unitNumber,
        expiryDate: lease.expiryDate,
        daysUntilExpiry: daysUntilExpiry(lease, asOf),
        bucket: expiryBucketFor(lease.expiryDate, asOf),
        monthlyRental: roundZar(lease.currentMonthlyRental),
        renewalOptionAvailable: lease.renewalOption.exists && !lease.renewalOption.exercised,
        ...(threshold !== null ? { noticeThreshold: threshold } : {}),
        ...(lease.openExpiryEventId ? { openEventId: lease.openExpiryEventId } : {}),
      }
    })
    .filter((row) => inReportStatuses(filters, row.bucket))
    .sort(byDateThenReference((row) => row.expiryDate))

  return {
    buckets: EXPIRY_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((row) => row.bucket === bucket)
      return { bucket, count: inBucket.length, monthlyRental: sumZar(inBucket.map((row) => row.monthlyRental)) }
    }),
    rows,
    expiredCount: rows.filter((row) => row.bucket === 'expired').length,
    withinNoticeCount: rows.filter((row) => row.noticeThreshold !== undefined).length,
    noticeDays,
    unverifiedLeasesExcluded: unverifiedCount(leases, filters),
  }
}

/**
 * The renewal deadlines report on `asOf`: every monitored lease at the filtered properties with a renewal option and a
 * recorded notice period, its notice deadline in the date range and its deadline status in the status filter, soonest
 * deadline first. An exercised option is listed (status `exercised`) so the record is complete; it needs no warning.
 */
export function buildRenewalDeadlinesReport(
  leases: readonly LeaseDateRecord[],
  settings: LeaseDateMonitoringSettings,
  asOf: ISODate,
  filters: ReportFilters = {},
): RenewalDeadlinesReport {
  const warningDays = thresholds(settings.renewalWarningDays)
  const atProperties = leases.filter((lease) => isMonitored(lease) && inReportProperties(filters, lease.propertyId))
  const warnings =
    settings.renewalWarningDays === null ? new Map<EntityId, number>() : new Map(leasesRequiringRenewalWarning(atProperties, asOf, warningDays).map((warning) => [warning.lease.leaseId, warning.threshold]))

  const rows: RenewalDeadlineRow[] = []
  for (const lease of atProperties) {
    const deadline = renewalNoticeDeadline(lease)
    const months = lease.renewalOption.noticePeriodMonths
    if (deadline === null || months === undefined || !inDateRange(filters, deadline)) continue
    const status = renewalDeadlineStatus(lease, asOf)
    if (status === 'not_applicable' || !inReportStatuses(filters, status)) continue
    const threshold = warnings.get(lease.leaseId)
    rows.push({
      leaseId: lease.leaseId,
      reference: lease.reference,
      tenantId: lease.tenantId,
      tenantName: lease.tenantName,
      propertyId: lease.propertyId,
      propertyName: lease.propertyName,
      unitNumber: lease.unitNumber,
      expiryDate: lease.expiryDate,
      noticePeriodMonths: months,
      deadline,
      daysUntilDeadline: daysBetween(asOf, deadline),
      status,
      ...(threshold !== undefined ? { warningThreshold: threshold } : {}),
      ...(lease.openRenewalEventId ? { openEventId: lease.openRenewalEventId } : {}),
    })
  }
  rows.sort(byDateThenReference((row) => row.deadline))

  const countsByStatus = Object.fromEntries(RENEWAL_DEADLINE_ROW_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length])) as Record<
    RenewalDeadlineRowStatus,
    number
  >

  return {
    rows,
    countsByStatus,
    requiringWarning: rows.filter((row) => row.warningThreshold !== undefined).length,
    warningDays,
    missingNoticePeriod: atProperties.filter((lease) => lease.renewalOption.exists && !lease.renewalOption.exercised && renewalNoticeDeadline(lease) === null).length,
    unverifiedLeasesExcluded: unverifiedCount(leases, filters),
  }
}
