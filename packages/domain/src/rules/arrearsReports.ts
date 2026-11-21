import type { ArrangementInstallment, ArrangementStatus, InstallmentFrequency } from '../types/arrangement.js'
import { ARRANGEMENT_STATUSES } from '../types/arrangement.js'
import type { EntityId, ISODate, ZAR } from '../types/common.js'
import type {
  ArrangementRow,
  ArrearsArrangementState,
  ArrearsReport,
  ArrearsRow,
  PaymentArrangementsReport,
  ReportFilters,
} from '../types/reports.js'
import {
  activeArrangementsForTenant,
  arrangementProgress,
  isArrangementActive,
  nextInstallment,
  overdueInstallments,
  shouldSuppressArrearsReminder,
} from './arrangements.js'
import { ageingBucket, ageingBucketLabels, DEFAULT_AGEING_BUCKETS, describeAgeingBucket, tenantCount, totalOutstanding } from './arrears.js'
import { compareISODate, daysBetween } from './dates.js'
import { sumZar } from './money.js'
import type { ArrearsAccount } from './portfolioReports.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'

/**
 * The arrears and payment arrangements reports (ticket R-05, PRD §7, §12.9), put together from the rows the database
 * returns (supabase/migrations/*_reports_arrears_arrangements.sql) with the rules the Statements page, the dashboard and
 * monitoring use: the outstanding balance of each account on its latest verified statement (`reports_arrears_accounts`,
 * the rules of `ageArrears` and `dashboard_arrears_totals`), aged into the company's buckets (`ageingBucket`); an active
 * payment arrangement is per tenant, never takes a balance out and pauses the tenant's normal reminders
 * (`shouldSuppressArrearsReminder`); an arrangement's progress, overdue and next instalments as the arrangement monitoring
 * counts them (`arrangementProgress`, `overdueInstallments` with the company's grace days, `nextInstallment`). Pure: the
 * caller supplies the rows and the as-at date. Monitoring records, never transactions: nothing here takes a payment.
 */

/** One account's latest verified statement with the names the report shows (`reports_arrears_detail`). */
export interface ArrearsReportAccount extends ArrearsAccount {
  tenantName: string
  propertyName: string
  unitNumber?: string
  leaseReference?: string
}

/** One payment arrangement with its instalments and the names the report shows (`reports_payment_arrangements`). */
export interface ReportArrangement {
  arrangementId: EntityId
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId: EntityId
  unitNumber: string
  leaseId: EntityId
  leaseReference: string
  status: ArrangementStatus
  frequency: InstallmentFrequency
  installmentAmount: ZAR
  outstandingBalance: ZAR
  firstInstallmentDate: ISODate
  finalInstallmentDate: ISODate
  agreedOn: ISODate
  closedOn?: ISODate
  suppressArrearsReminders: boolean
  installments: readonly ArrangementInstallment[]
}

/** Whether a tenant in arrears is under an active arrangement, as the arrears report's status filter names it. */
export function arrearsArrangementState(row: Pick<ArrearsRow, 'underArrangement'>): ArrearsArrangementState {
  return row.underArrangement ? 'under_arrangement' : 'no_arrangement'
}

/**
 * The arrears report on `asOf`: every account whose latest verified statement shows a balance (zero and credit are not
 * arrears), aged from the statement date into `buckets` (the company's arrears monitoring buckets), marked when an
 * active arrangement is in force for the tenant and when it pauses the tenant's reminders. Narrowed to the filtered
 * properties and arrangement states; the totals and buckets add up the rows shown. Without filters the total and the
 * tenant count equal the dashboard's and the Statements page's.
 */
export function buildArrearsReport(input: {
  accounts: readonly ArrearsReportAccount[]
  arrangements: readonly ReportArrangement[]
  asOf: ISODate
  buckets?: readonly number[]
  filters?: ReportFilters
}): ArrearsReport {
  const { asOf, arrangements } = input
  const filters = input.filters ?? {}
  const buckets = [...(input.buckets && input.buckets.length > 0 ? input.buckets : DEFAULT_AGEING_BUCKETS)].sort((a, b) => a - b)

  const rows = input.accounts
    .filter((account) => account.outstanding > 0)
    .map((account): ArrearsRow => {
      const inForce = activeArrangementsForTenant(account.tenantId, arrangements, asOf).sort(
        (a, b) => compareISODate(b.agreedOn, a.agreedOn) || (a.arrangementId < b.arrangementId ? -1 : 1),
      )
      return {
        tenantId: account.tenantId,
        tenantName: account.tenantName,
        propertyId: account.propertyId,
        propertyName: account.propertyName,
        ...(account.unitId ? { unitId: account.unitId } : {}),
        ...(account.unitNumber ? { unitNumber: account.unitNumber } : {}),
        ...(account.leaseId ? { leaseId: account.leaseId } : {}),
        ...(account.leaseReference ? { leaseReference: account.leaseReference } : {}),
        statementId: account.statementId,
        statementDate: account.statementDate,
        outstanding: account.outstanding,
        ageDays: daysBetween(account.statementDate, asOf),
        bucket: ageingBucket(account.statementDate, asOf, buckets),
        underArrangement: inForce.length > 0,
        remindersSuppressed: shouldSuppressArrearsReminder(account.tenantId, arrangements, asOf),
        ...(inForce[0] ? { arrangementId: inForce[0].arrangementId } : {}),
      }
    })
    .filter((row) => inReportProperties(filters, row.propertyId) && inReportStatuses(filters, arrearsArrangementState(row)))
    .sort((a, b) => b.outstanding - a.outstanding || a.tenantName.localeCompare(b.tenantName) || (a.statementId < b.statementId ? -1 : 1))

  const underArrangement = rows.filter((row) => row.underArrangement)

  return {
    ageingBuckets: buckets,
    totalOutstanding: totalOutstanding(rows),
    tenantCount: tenantCount(rows),
    tenantsUnderArrangement: tenantCount(underArrangement),
    tenantsWithRemindersSuppressed: tenantCount(rows.filter((row) => row.remindersSuppressed)),
    outstandingUnderArrangement: totalOutstanding(underArrangement),
    buckets: ageingBucketLabels(buckets).map((bucket) => {
      const inBucket = rows.filter((row) => row.bucket === bucket)
      return { bucket, description: describeAgeingBucket(bucket, buckets), amount: totalOutstanding(inBucket), tenantCount: tenantCount(inBucket) }
    }),
    rows,
  }
}

/** Display order of the arrangements: the ones in force first, the ended ones last. */
const STATUS_ORDER: readonly ArrangementStatus[] = ['active', 'proposed', 'defaulted', 'completed', 'cancelled']

function inAgreedRange(filters: ReportFilters, agreedOn: ISODate): boolean {
  if (filters.from && compareISODate(agreedOn, filters.from) < 0) return false
  if (filters.to && compareISODate(agreedOn, filters.to) > 0) return false
  return true
}

/**
 * The payment arrangements report on `asOf`: every arrangement (proposed, active, completed, defaulted and cancelled)
 * with its schedule progress (instalments recorded as paid), its missed instalments, and while it is in force its
 * overdue instalments (open past the due date plus `graceDays`, as the arrangement monitoring counts them) and its next
 * instalment. Narrowed to the filtered properties, agreement dates and statuses; the totals add up the rows shown.
 */
export function buildPaymentArrangementsReport(input: {
  arrangements: readonly ReportArrangement[]
  asOf: ISODate
  graceDays?: number
  filters?: ReportFilters
}): PaymentArrangementsReport {
  const { asOf } = input
  const filters = input.filters ?? {}
  const graceDays = input.graceDays ?? 0

  const shown = input.arrangements
    .filter((a) => inReportProperties(filters, a.propertyId) && inAgreedRange(filters, a.agreedOn) && inReportStatuses(filters, a.status))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        compareISODate(b.agreedOn, a.agreedOn) ||
        (a.arrangementId < b.arrangementId ? -1 : 1),
    )

  const inForce = new Set<EntityId>()
  const rows = shown.map((a): ArrangementRow => {
    const progress = arrangementProgress(a)
    const active = isArrangementActive(a, asOf)
    if (active) inForce.add(a.arrangementId)
    const next = active ? nextInstallment(a, asOf) : undefined
    return {
      arrangementId: a.arrangementId,
      tenantId: a.tenantId,
      tenantName: a.tenantName,
      propertyId: a.propertyId,
      propertyName: a.propertyName,
      unitId: a.unitId,
      unitNumber: a.unitNumber,
      leaseId: a.leaseId,
      leaseReference: a.leaseReference,
      status: a.status,
      frequency: a.frequency,
      installmentAmount: a.installmentAmount,
      agreedOn: a.agreedOn,
      finalInstallmentDate: a.finalInstallmentDate,
      ...(a.closedOn ? { closedOn: a.closedOn } : {}),
      suppressArrearsReminders: a.suppressArrearsReminders,
      outstandingBalance: a.outstandingBalance,
      ...progress,
      missedCount: a.installments.filter((i) => i.status === 'missed').length,
      overdueCount: active ? overdueInstallments(a, asOf, graceDays).length : 0,
      ...(next ? { nextDueDate: next.dueDate, nextAmount: next.amount } : {}),
    }
  })

  const countsByStatus = Object.fromEntries(ARRANGEMENT_STATUSES.map((status) => [status, 0])) as Record<ArrangementStatus, number>
  for (const row of rows) countsByStatus[row.status] += 1

  return {
    graceDays,
    countsByStatus,
    activeCount: inForce.size,
    outstandingUnderArrangement: sumZar(rows.filter((row) => inForce.has(row.arrangementId)).map((row) => row.remaining)),
    paidToDate: sumZar(rows.map((row) => row.paid)),
    missedInstallments: rows.reduce((total, row) => total + row.missedCount, 0),
    overdueInstallments: rows.reduce((total, row) => total + row.overdueCount, 0),
    rows,
  }
}
