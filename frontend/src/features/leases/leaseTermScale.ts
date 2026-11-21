import { compareISODate, daysBetween, renewalNoticeDeadline } from '@leaseguard/domain'
import type { ISODate, Lease } from '@leaseguard/domain'

export type TermLease = Pick<Lease, 'id' | 'reference' | 'commencementDate' | 'expiryDate' | 'renewalOption'>

/** One lease placed on the shared time axis; positions are percentages of the axis width. */
export interface TermBar {
  lease: TermLease
  left: number
  width: number
  /** The renewal-notice deadline and its position, when the lease has one. */
  notice: { date: ISODate; at: number } | null
}

export interface TermScale {
  start: ISODate
  end: ISODate
  bars: TermBar[]
  /** Calendar years whose 1 January falls on the axis, with their positions. */
  years: { year: number; at: number }[]
  /** Today's position, when today falls on the axis. */
  today: number | null
}

const percent = (from: ISODate, to: ISODate, span: number): number => (span === 0 ? 0 : (daysBetween(from, to) / span) * 100)

/**
 * Lays leases out on one axis from the earliest commencement to the latest expiry, so every bar's length is
 * its exact term and the terms compare at a glance. Returns `null` when there are no leases.
 */
export function leaseTermScale(leases: readonly TermLease[], today: ISODate): TermScale | null {
  if (leases.length === 0) return null
  const start = leases.map((l) => l.commencementDate).reduce((a, b) => (compareISODate(a, b) <= 0 ? a : b))
  const end = leases.map((l) => l.expiryDate).reduce((a, b) => (compareISODate(a, b) >= 0 ? a : b))
  const span = daysBetween(start, end)

  const bars = leases
    .toSorted((a, b) => compareISODate(a.commencementDate, b.commencementDate) || a.reference.localeCompare(b.reference))
    .map((lease) => {
      const deadline = renewalNoticeDeadline(lease)
      const onAxis = deadline !== null && compareISODate(deadline, start) >= 0 && compareISODate(deadline, end) <= 0
      return {
        lease,
        left: percent(start, lease.commencementDate, span),
        width: percent(lease.commencementDate, lease.expiryDate, span),
        notice: onAxis && deadline ? { date: deadline, at: percent(start, deadline, span) } : null,
      }
    })

  const years: { year: number; at: number }[] = []
  for (let year = Number(start.slice(0, 4)) + 1; year <= Number(end.slice(0, 4)); year += 1) {
    years.push({ year, at: percent(start, `${year}-01-01` as ISODate, span) })
  }

  const todayOnAxis = compareISODate(today, start) >= 0 && compareISODate(today, end) <= 0
  return { start, end, bars, years, today: todayOnAxis ? percent(start, today, span) : null }
}
