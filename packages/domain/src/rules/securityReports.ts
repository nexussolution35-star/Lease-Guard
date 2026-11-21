import type { EntityId, ISODate } from '../types/common.js'
import type { BankGuarantee, Deposit, LeaseEscalation, LeaseStatus } from '../types/lease.js'
import type { DepositsGuaranteesReport, ReportFilters, SecurityRow } from '../types/reports.js'
import { compareISODate } from './dates.js'
import { expectedRental } from './escalation.js'
import { depositCoverage, guaranteeCoverage, guaranteeExpiryStatus } from './guarantee.js'
import { MONITORED_LEASE_STATUSES } from './leaseExpiry.js'
import { sumZar } from './money.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'

/**
 * The deposits and guarantees report (ticket R-04, PRD §5.7 D, §7, §12.9), put together from the leases the database
 * returns (supabase/migrations/*_reports_deposits_guarantees.sql) with the rules lease monitoring uses
 * (backend/src/workers/monitoring/lease-monitoring.findings.ts), so a row's required cover and shortfall are the
 * figures of the monitoring event for the same lease on the same day:
 *
 *   * only VERIFIED leases in a monitored status (active, expiring) are listed: unverified terms never drive financial
 *     monitoring; leases that have not ended but are not verified are counted as excluded;
 *   * required cover = basis months × the rental the verified terms expect as at the report date (`guaranteeCoverage`,
 *     `depositCoverage`); a guarantee's cover is checked while its recorded status is active or expiring, as
 *     monitoring checks it; a deposit's when the lease records its basis months;
 *   * a guarantee's state comes from `guaranteeExpiryStatus` with the company's guarantee expiry notice days.
 *
 * Pure: the caller supplies the rows, the date and the notice days.
 */

/** One lease with a deposit or a bank guarantee, as `reports_lease_security` returns it (every status). */
export interface LeaseSecurityRecord {
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
  commencementDate: ISODate
  expiryDate: ISODate
  initialMonthlyRental: number
  escalation: LeaseEscalation
  deposit?: Deposit
  bankGuarantee?: BankGuarantee
}

/** Lease statuses after which a lease has ended (as the portfolio overview counts unverified leases). */
const ENDED_LEASE_STATUSES: readonly LeaseStatus[] = ['expired', 'renewed', 'terminated']

/** A guarantee whose cover lease monitoring checks: recorded as active or expiring (not released, called or expired). */
const IN_FORCE_RECORDED: readonly BankGuarantee['status'][] = ['active', 'expiring']

/** Guarantee states (rules/guarantee.ts) that count towards the guarantees in force. */
const IN_FORCE_STATES: readonly string[] = ['active', 'expiring']

/**
 * The guarantee expiry notice days the report uses, as lease monitoring does: the company's guarantee expiry rule's
 * `noticeDays` when it sets valid ones, else the company's setting. Positive whole days, without repeats, largest first.
 */
export function guaranteeNoticeDaysFor(companyNoticeDays: readonly number[], ruleNoticeDays?: readonly number[] | null): number[] {
  const valid = (days: readonly number[] | null | undefined): days is readonly number[] =>
    Array.isArray(days) && days.every((day) => Number.isInteger(day) && day > 0)
  const days = valid(ruleNoticeDays) ? ruleNoticeDays : companyNoticeDays
  return [...new Set(days)].sort((a, b) => b - a)
}

/** One listed lease's row: its deposit and guarantee, their required cover and shortfall, and the guarantee's state. */
export function securityRow(record: LeaseSecurityRecord, asOf: ISODate, noticeDays: readonly number[]): SecurityRow {
  const { deposit, bankGuarantee: guarantee } = record
  const depositCover = depositCoverage(record, asOf)
  const guaranteeCover = guarantee && IN_FORCE_RECORDED.includes(guarantee.status) ? guaranteeCoverage(record, asOf) : null
  const expiry = guarantee ? guaranteeExpiryStatus(guarantee, asOf, noticeDays) : null
  const depositShortfall = depositCover?.shortfall ?? 0
  const guaranteeShortfall = guaranteeCover?.shortfall ?? 0

  return {
    leaseId: record.leaseId,
    reference: record.reference,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    propertyId: record.propertyId,
    propertyName: record.propertyName,
    unitId: record.unitId,
    unitNumber: record.unitNumber,
    expectedMonthlyRental: expectedRental(record, asOf),
    ...(deposit
      ? {
          depositAmount: deposit.amount,
          depositHeldBy: deposit.heldBy,
          ...(deposit.basisMonths !== undefined ? { depositBasisMonths: deposit.basisMonths } : {}),
        }
      : {}),
    ...(depositCover ? { depositRequired: depositCover.required } : {}),
    depositShortfall,
    ...(guarantee
      ? {
          guaranteeBank: guarantee.bank,
          guaranteeReference: guarantee.referenceNumber,
          guaranteeAmount: guarantee.amount,
          guaranteeBasisMonths: guarantee.basisMonths,
          guaranteeExpiresOn: guarantee.expiresOn,
        }
      : {}),
    ...(guaranteeCover ? { guaranteeRequired: guaranteeCover.required } : {}),
    guaranteeShortfall,
    ...(expiry ? { guaranteeState: expiry.state, guaranteeDaysUntilExpiry: expiry.daysUntilExpiry } : {}),
    needsAttention: depositShortfall > 0 || guaranteeShortfall > 0 || expiry?.state === 'expiring' || expiry?.state === 'expired',
  }
}

/** Whether the row's guarantee expiry passes the date range (no range: every row; a range: only rows with a guarantee). */
function inExpiryRange(filters: ReportFilters, row: SecurityRow): boolean {
  if (!filters.from && !filters.to) return true
  if (!row.guaranteeExpiresOn) return false
  if (filters.from && compareISODate(row.guaranteeExpiresOn, filters.from) < 0) return false
  if (filters.to && compareISODate(row.guaranteeExpiresOn, filters.to) > 0) return false
  return true
}

/** Whether the row's guarantee state passes the status filter (a status filter leaves out leases without a guarantee). */
function inGuaranteeStates(filters: ReportFilters, row: SecurityRow): boolean {
  if (!filters.statuses || filters.statuses.length === 0) return true
  return row.guaranteeState !== undefined && inReportStatuses(filters, row.guaranteeState)
}

/**
 * The report of the leases `reports_lease_security` returns, as at `asOf` with the guarantee expiry `noticeDays`,
 * narrowed by the filters: properties, the guarantee expiry date range and the guarantee states. Rows keep the order
 * they come in (property, then lease reference); the totals add up the rows listed.
 */
export function buildDepositsGuaranteesReport(
  records: readonly LeaseSecurityRecord[],
  asOf: ISODate,
  noticeDays: readonly number[],
  filters: ReportFilters = {},
): DepositsGuaranteesReport {
  const inProperties = records.filter((record) => inReportProperties(filters, record.propertyId))
  const rows = inProperties
    .filter((record) => record.verified && MONITORED_LEASE_STATUSES.includes(record.status))
    .map((record) => securityRow(record, asOf, noticeDays))
    .filter((row) => inExpiryRange(filters, row) && inGuaranteeStates(filters, row))

  const countState = (state: string) => rows.filter((row) => row.guaranteeState === state).length

  return {
    totalDeposits: sumZar(rows.map((row) => row.depositAmount ?? 0)),
    totalGuarantees: sumZar(rows.filter((row) => row.guaranteeState !== undefined && IN_FORCE_STATES.includes(row.guaranteeState)).map((row) => row.guaranteeAmount ?? 0)),
    depositShortfallTotal: sumZar(rows.map((row) => row.depositShortfall)),
    guaranteeShortfallTotal: sumZar(rows.map((row) => row.guaranteeShortfall)),
    leasesWithShortfall: rows.filter((row) => row.depositShortfall > 0 || row.guaranteeShortfall > 0).length,
    expiringGuarantees: countState('expiring'),
    expiredGuarantees: countState('expired'),
    guaranteeNoticeDays: [...noticeDays],
    rows,
    unverifiedLeasesExcluded: inProperties.filter((record) => !record.verified && !ENDED_LEASE_STATUSES.includes(record.status)).length,
  }
}
