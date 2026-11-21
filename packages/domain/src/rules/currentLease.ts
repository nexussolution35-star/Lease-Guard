import type { ISODate, LeaseStatus } from '../types/index.js'
import { compareISODate } from './dates.js'

/**
 * Which of a tenant's leases counts as the current one, best first: a lease in force, then one still being
 * set up, then one that has ended (renewed before expired or terminated, since a renewal replaced it).
 */
export const CURRENT_LEASE_PREFERENCE: readonly LeaseStatus[] = [
  'active',
  'expiring',
  'pending_verification',
  'draft',
  'renewed',
  'expired',
  'terminated',
]

/**
 * The tenant's current lease: the one with the most preferred status (`CURRENT_LEASE_PREFERENCE`); among equals,
 * the latest commencement date, then the lowest id so the choice is stable. Undefined when there are no leases.
 */
export function currentLease<L extends { id: string; status: LeaseStatus; commencementDate: ISODate }>(
  leases: readonly L[],
): L | undefined {
  const rank = (lease: L) => CURRENT_LEASE_PREFERENCE.indexOf(lease.status)
  return [...leases].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compareISODate(b.commencementDate, a.commencementDate) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0]
}
