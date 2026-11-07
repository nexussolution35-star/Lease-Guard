import type { ISODate, Lease, LeaseStatus } from '../types/index.js'
import { compareISODate, daysBetween } from './dates.js'

/** Lease statuses whose expiry is actively monitored. */
export const MONITORED_LEASE_STATUSES: readonly LeaseStatus[] = ['active', 'expiring']

export const LEASE_EXPIRY_STATUSES = [
  'expired',
  'expiring_critical',
  'expiring_soon',
  'expiring_watch',
  'current',
] as const
export type LeaseExpiryStatus = (typeof LEASE_EXPIRY_STATUSES)[number]

/** Thresholds in days (inclusive upper bounds). */
export const EXPIRY_THRESHOLDS = { critical: 30, soon: 90, watch: 180 } as const

/** Signed calendar days from `today` to the expiry date; negative once expired. */
export function daysUntilExpiry(lease: Pick<Lease, 'expiryDate'>, today: ISODate): number {
  return daysBetween(today, lease.expiryDate)
}

export function expiryStatusForDays(days: number): LeaseExpiryStatus {
  if (days < 0) return 'expired'
  if (days <= EXPIRY_THRESHOLDS.critical) return 'expiring_critical'
  if (days <= EXPIRY_THRESHOLDS.soon) return 'expiring_soon'
  if (days <= EXPIRY_THRESHOLDS.watch) return 'expiring_watch'
  return 'current'
}

export function leaseExpiryStatus(lease: Pick<Lease, 'expiryDate'>, today: ISODate): LeaseExpiryStatus {
  return expiryStatusForDays(daysUntilExpiry(lease, today))
}

export interface UpcomingExpiry<L extends Pick<Lease, 'expiryDate' | 'status'>> {
  lease: L
  daysUntilExpiry: number
  status: LeaseExpiryStatus
}

/**
 * Monitored leases expiring within `withinDays` (0 ≤ days ≤ withinDays), soonest first.
 * Already-expired, terminated, renewed and draft leases are excluded.
 */
export function upcomingExpiries<L extends Pick<Lease, 'expiryDate' | 'status'>>(
  leases: readonly L[],
  today: ISODate,
  withinDays: number,
): UpcomingExpiry<L>[] {
  const out: UpcomingExpiry<L>[] = []
  for (const lease of leases) {
    if (!MONITORED_LEASE_STATUSES.includes(lease.status)) continue
    const days = daysUntilExpiry(lease, today)
    if (days < 0 || days > withinDays) continue
    out.push({ lease, daysUntilExpiry: days, status: expiryStatusForDays(days) })
  }
  return out.sort(
    (a, b) => compareISODate(a.lease.expiryDate, b.lease.expiryDate) || a.daysUntilExpiry - b.daysUntilExpiry,
  )
}

/**
 * Given company notice thresholds (e.g. [180, 90, 30]), return the threshold most recently
 * crossed: the SMALLEST threshold that is ≥ days-until-expiry. `null` when the lease is not
 * yet inside any threshold, or has already expired.
 */
export function crossedThreshold(days: number, thresholds: readonly number[]): number | null {
  if (days < 0) return null
  let best: number | null = null
  for (const t of thresholds) {
    if (t >= days && (best === null || t < best)) best = t
  }
  return best
}

export function shouldRaiseExpiryEvent(
  lease: Pick<Lease, 'expiryDate' | 'status'>,
  today: ISODate,
  noticeDays: readonly number[],
): number | null {
  if (!MONITORED_LEASE_STATUSES.includes(lease.status)) return null
  return crossedThreshold(daysUntilExpiry(lease, today), noticeDays)
}
