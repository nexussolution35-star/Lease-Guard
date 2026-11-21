import { describe, expect, it } from 'vitest'

import type { ISODate } from '@leaseguard/domain'

import { leaseTermScale, type TermLease } from './leaseTermScale'

const lease = (reference: string, commencementDate: string, expiryDate: string, noticePeriodMonths?: number): TermLease => ({
  id: reference,
  reference,
  commencementDate: commencementDate as ISODate,
  expiryDate: expiryDate as ISODate,
  renewalOption:
    noticePeriodMonths === undefined
      ? { exists: false, exercised: false }
      : { exists: true, exercised: false, noticePeriodMonths },
} as TermLease)

describe('leaseTermScale', () => {
  it('returns null without leases', () => {
    expect(leaseTermScale([], '2026-11-20' as ISODate)).toBeNull()
  })

  it('spans the earliest commencement to the latest expiry and draws each term to scale', () => {
    const scale = leaseTermScale(
      [lease('B', '2024-01-01', '2026-01-01'), lease('A', '2022-01-01', '2026-01-01', 6)],
      '2025-01-01' as ISODate,
    )!
    expect(scale.start).toBe('2022-01-01')
    expect(scale.end).toBe('2026-01-01')
    expect(scale.bars.map((b) => b.lease.reference)).toEqual(['A', 'B'])
    expect(scale.bars[0]!.left).toBe(0)
    expect(scale.bars[0]!.width).toBe(100)
    expect(scale.bars[1]!.left).toBeCloseTo(49.97, 1)
    expect(scale.bars[0]!.notice?.date).toBe('2025-07-01')
    expect(scale.bars[1]!.notice).toBeNull()
    expect(scale.years.map((y) => y.year)).toEqual([2023, 2024, 2025, 2026])
    expect(scale.today).toBeCloseTo(74.98, 1)
  })

  it('leaves today off the axis when it falls outside every term', () => {
    expect(leaseTermScale([lease('A', '2022-01-01', '2023-01-01')], '2026-11-20' as ISODate)!.today).toBeNull()
  })
})
