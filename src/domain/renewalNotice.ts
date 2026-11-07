import type { ISODate, Lease } from '@/types'
import { addMonthsISO, compareISODate, daysBetween } from './dates'
import { crossedThreshold, MONITORED_LEASE_STATUSES } from './leaseExpiry'

type RenewalLease = Pick<Lease, 'expiryDate' | 'renewalOption' | 'status'>

/**
 * Last day on which written renewal notice may be given: expiry minus `noticePeriodMonths`.
 * Rule: same day-of-month, clamped to the target month's last day (date-fns `addMonths`).
 *   expiry 2027-12-31, 3 months → 2027-09-30 (September has 30 days)
 *   expiry 2027-05-31, 3 months → 2027-02-28
 *   expiry 2027-06-15, 6 months → 2026-12-15
 * `null` when there is no renewal option or no notice period is recorded.
 */
export function renewalNoticeDeadline(lease: Pick<Lease, 'expiryDate' | 'renewalOption'>): ISODate | null {
  const { renewalOption } = lease
  if (!renewalOption.exists) return null
  const months = renewalOption.noticePeriodMonths
  if (months === undefined || months < 0) return null
  return addMonthsISO(lease.expiryDate, -months)
}

/** Signed days from `today` to the deadline; `null` when no deadline applies. */
export function daysUntilRenewalDeadline(lease: Pick<Lease, 'expiryDate' | 'renewalOption'>, today: ISODate): number | null {
  const deadline = renewalNoticeDeadline(lease)
  return deadline === null ? null : daysBetween(today, deadline)
}

export const RENEWAL_DEADLINE_STATUSES = [
  'not_applicable',
  'exercised',
  'passed',
  'due_critical',
  'due_soon',
  'upcoming',
  'open',
] as const
export type RenewalDeadlineStatus = (typeof RENEWAL_DEADLINE_STATUSES)[number]

/** Inclusive day thresholds for deadline urgency. */
export const RENEWAL_DEADLINE_THRESHOLDS = { critical: 14, soon: 30, upcoming: 90 } as const

export function renewalDeadlineStatus(lease: Pick<Lease, 'expiryDate' | 'renewalOption'>, today: ISODate): RenewalDeadlineStatus {
  if (lease.renewalOption.exercised) return 'exercised'
  const days = daysUntilRenewalDeadline(lease, today)
  if (days === null) return 'not_applicable'
  if (days < 0) return 'passed'
  if (days <= RENEWAL_DEADLINE_THRESHOLDS.critical) return 'due_critical'
  if (days <= RENEWAL_DEADLINE_THRESHOLDS.soon) return 'due_soon'
  if (days <= RENEWAL_DEADLINE_THRESHOLDS.upcoming) return 'upcoming'
  return 'open'
}

export interface RenewalWarning<L extends RenewalLease> {
  lease: L
  deadline: ISODate
  daysUntilDeadline: number
  /** The company warning threshold (days) most recently crossed. */
  threshold: number
}

/**
 * Monitored leases with an unexercised renewal option whose notice deadline falls inside one of
 * the company's `warningDays` thresholds (e.g. [60, 30, 14]). Soonest deadline first.
 */
export function leasesRequiringRenewalWarning<L extends RenewalLease>(
  leases: readonly L[],
  today: ISODate,
  warningDays: readonly number[],
): RenewalWarning<L>[] {
  const out: RenewalWarning<L>[] = []
  for (const lease of leases) {
    if (!MONITORED_LEASE_STATUSES.includes(lease.status)) continue
    if (lease.renewalOption.exercised) continue
    const deadline = renewalNoticeDeadline(lease)
    if (deadline === null) continue
    const days = daysBetween(today, deadline)
    const threshold = crossedThreshold(days, warningDays)
    if (threshold === null) continue
    out.push({ lease, deadline, daysUntilDeadline: days, threshold })
  }
  return out.sort((a, b) => compareISODate(a.deadline, b.deadline))
}
