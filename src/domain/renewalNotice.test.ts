import { describe, expect, it } from 'vitest'
import { makeLease } from './__fixtures__/lease'
import {
  daysUntilRenewalDeadline,
  leasesRequiringRenewalWarning,
  renewalDeadlineStatus,
  renewalNoticeDeadline,
} from './renewalNotice'

const today = '2026-11-06'
const withNotice = (expiryDate: string, months: number) =>
  makeLease({ expiryDate, renewalOption: { exists: true, noticePeriodMonths: months, exercised: false } })

describe('renewalNoticeDeadline', () => {
  it('spec example: expiry 31 Dec, 3 months → 30 Sep', () => {
    expect(renewalNoticeDeadline(withNotice('2027-12-31', 3))).toBe('2027-09-30')
  })
  it('clamps to month end and keeps the day otherwise', () => {
    expect(renewalNoticeDeadline(withNotice('2027-05-31', 3))).toBe('2027-02-28')
    expect(renewalNoticeDeadline(withNotice('2027-06-15', 6))).toBe('2026-12-15')
    expect(renewalNoticeDeadline(withNotice('2027-03-31', 1))).toBe('2027-02-28')
  })
  it('is null without an option or notice period', () => {
    expect(renewalNoticeDeadline(makeLease({ renewalOption: { exists: false, exercised: false } }))).toBeNull()
    expect(renewalNoticeDeadline(makeLease({ renewalOption: { exists: true, exercised: false } }))).toBeNull()
  })
})

describe('daysUntilRenewalDeadline / renewalDeadlineStatus', () => {
  it('derives days and status', () => {
    expect(daysUntilRenewalDeadline(withNotice('2027-02-06', 3), today)).toBe(0)
    expect(renewalDeadlineStatus(withNotice('2027-02-06', 3), today)).toBe('due_critical')
    expect(renewalDeadlineStatus(withNotice('2027-02-26', 3), today)).toBe('due_soon') // 20d
    expect(renewalDeadlineStatus(withNotice('2027-04-06', 3), today)).toBe('upcoming') // 61d
    expect(renewalDeadlineStatus(withNotice('2028-04-06', 3), today)).toBe('open')
    expect(renewalDeadlineStatus(withNotice('2027-01-06', 3), today)).toBe('passed')
    expect(renewalDeadlineStatus(makeLease({ renewalOption: { exists: false, exercised: false } }), today)).toBe('not_applicable')
    expect(
      renewalDeadlineStatus(makeLease({ renewalOption: { exists: true, noticePeriodMonths: 3, exercised: true } }), today),
    ).toBe('exercised')
  })
})

describe('leasesRequiringRenewalWarning', () => {
  it('filters by threshold and excludes exercised / unmonitored', () => {
    const leases = [
      { ...withNotice('2027-02-20', 3), id: 'soon' }, // deadline 2026-11-20, 14d
      { ...withNotice('2027-03-20', 3), id: 'later' }, // deadline 2026-12-20, 44d
      { ...withNotice('2028-03-20', 3), id: 'far' },
      { ...withNotice('2027-02-20', 3), id: 'done', renewalOption: { exists: true, noticePeriodMonths: 3, exercised: true } },
      { ...withNotice('2027-02-20', 3), id: 'terminated', status: 'terminated' as const },
    ]
    const result = leasesRequiringRenewalWarning(leases, today, [60, 30, 14])
    expect(result.map((r) => r.lease.id)).toEqual(['soon', 'later'])
    expect(result[0]).toMatchObject({ deadline: '2026-11-20', daysUntilDeadline: 14, threshold: 14 })
    expect(result[1].threshold).toBe(60)
  })
})
