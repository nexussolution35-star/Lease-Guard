import { describe, expect, it } from 'vitest'
import { makeLease } from './__fixtures__/lease'
import {
  crossedThreshold,
  daysUntilExpiry,
  leaseExpiryStatus,
  shouldRaiseExpiryEvent,
  upcomingExpiries,
} from './leaseExpiry'

const today = '2026-11-06'

describe('daysUntilExpiry / leaseExpiryStatus', () => {
  it('computes signed days', () => {
    expect(daysUntilExpiry(makeLease({ expiryDate: '2026-12-06' }), today)).toBe(30)
    expect(daysUntilExpiry(makeLease({ expiryDate: '2026-11-05' }), today)).toBe(-1)
  })
  it('classifies by threshold, inclusive', () => {
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2026-11-05' }), today)).toBe('expired')
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2026-11-06' }), today)).toBe('expiring_critical')
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2026-12-06' }), today)).toBe('expiring_critical') // 30
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2026-12-07' }), today)).toBe('expiring_soon') // 31
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2027-02-04' }), today)).toBe('expiring_soon') // 90
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2027-02-05' }), today)).toBe('expiring_watch') // 91
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2027-05-05' }), today)).toBe('expiring_watch') // 180
    expect(leaseExpiryStatus(makeLease({ expiryDate: '2027-05-06' }), today)).toBe('current') // 181
  })
})

describe('upcomingExpiries', () => {
  it('returns monitored leases within the window, soonest first', () => {
    const leases = [
      makeLease({ id: 'c', expiryDate: '2027-01-15' }),
      makeLease({ id: 'a', expiryDate: '2026-11-20' }),
      makeLease({ id: 'expired', expiryDate: '2026-10-01' }),
      makeLease({ id: 'terminated', expiryDate: '2026-11-10', status: 'terminated' }),
      makeLease({ id: 'far', expiryDate: '2028-01-01' }),
      makeLease({ id: 'b', expiryDate: '2026-12-01', status: 'expiring' }),
    ]
    const result = upcomingExpiries(leases, today, 90)
    expect(result.map((r) => r.lease.id)).toEqual(['a', 'b', 'c'])
    expect(result[0].daysUntilExpiry).toBe(14)
    expect(result[0].status).toBe('expiring_critical')
  })
})

describe('crossedThreshold / shouldRaiseExpiryEvent', () => {
  const notice = [180, 90, 30]
  it('returns the smallest threshold ≥ days', () => {
    expect(crossedThreshold(45, notice)).toBe(90)
    expect(crossedThreshold(30, notice)).toBe(30)
    expect(crossedThreshold(0, notice)).toBe(30)
    expect(crossedThreshold(181, notice)).toBeNull()
    expect(crossedThreshold(-1, notice)).toBeNull()
  })
  it('respects lease status', () => {
    expect(shouldRaiseExpiryEvent(makeLease({ expiryDate: '2026-12-21' }), today, notice)).toBe(90)
    expect(shouldRaiseExpiryEvent(makeLease({ expiryDate: '2026-12-21', status: 'renewed' }), today, notice)).toBeNull()
  })
})
