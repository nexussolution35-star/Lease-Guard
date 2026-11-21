import { describe, expect, it } from 'vitest'

import { buildLeaseExpiryReport, buildRenewalDeadlinesReport, expiryBucketFor, type LeaseDateMonitoringSettings, type LeaseDateRecord } from './leaseDateReports.js'
import { shouldRaiseExpiryEvent } from './leaseExpiry.js'
import { leasesRequiringRenewalWarning } from './renewalNotice.js'
import { REPORT_FILTER_SUPPORT, reportFilterProblems } from './reportFrame.js'

const AS_OF = '2026-11-21'

const lease = (patch: Partial<LeaseDateRecord> & Pick<LeaseDateRecord, 'leaseId' | 'expiryDate'>): LeaseDateRecord => ({
  reference: patch.leaseId.toUpperCase(),
  status: 'active',
  verified: true,
  tenantId: `t-${patch.leaseId}`,
  tenantName: `Tenant ${patch.leaseId}`,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  unitId: `u-${patch.leaseId}`,
  unitNumber: `S-${patch.leaseId}`,
  currentMonthlyRental: 10000,
  renewalOption: { exists: false, exercised: false },
  ...patch,
})

const SETTINGS: LeaseDateMonitoringSettings = { leaseExpiryNoticeDays: [30, 180, 90], renewalWarningDays: [60, 90, 30] }

describe('expiryBucketFor', () => {
  it('buckets by calendar months from the as-at date, each bucket ending inclusive', () => {
    expect(expiryBucketFor('2026-11-20', AS_OF)).toBe('expired')
    expect(expiryBucketFor(AS_OF, AS_OF)).toBe('months_0_3')
    expect(expiryBucketFor('2027-02-21', AS_OF)).toBe('months_0_3')
    expect(expiryBucketFor('2027-02-22', AS_OF)).toBe('months_3_6')
    expect(expiryBucketFor('2027-05-21', AS_OF)).toBe('months_3_6')
    expect(expiryBucketFor('2027-05-22', AS_OF)).toBe('months_6_12')
    expect(expiryBucketFor('2027-11-21', AS_OF)).toBe('months_6_12')
    expect(expiryBucketFor('2027-11-22', AS_OF)).toBe('later')
  })

  it('clamps a month to the last day of the target month', () => {
    // 30 Nov + 3 months = 28 Feb (2027 is not a leap year).
    expect(expiryBucketFor('2027-02-28', '2026-11-30')).toBe('months_0_3')
    expect(expiryBucketFor('2027-03-01', '2026-11-30')).toBe('months_3_6')
  })
})

describe('buildLeaseExpiryReport', () => {
  const LEASES: LeaseDateRecord[] = [
    lease({ leaseId: 'l3', expiryDate: '2027-08-31', currentMonthlyRental: 12500 }),
    lease({ leaseId: 'l1', expiryDate: '2026-12-15', openExpiryEventId: 'e1', renewalOption: { exists: true, exercised: false, noticePeriodMonths: 3 } }),
    lease({ leaseId: 'l0', expiryDate: '2026-11-01', status: 'expiring' }),
    lease({ leaseId: 'l2', expiryDate: '2027-04-30', renewalOption: { exists: true, exercised: true, noticePeriodMonths: 3 } }),
    lease({ leaseId: 'l4', expiryDate: '2030-01-31', propertyId: 'p2', propertyName: 'Westgate' }),
    // Not monitored: unverified, or an unmonitored status.
    lease({ leaseId: 'u1', expiryDate: '2026-12-01', verified: false, status: 'pending_verification' }),
    lease({ leaseId: 'u2', expiryDate: '2026-12-01', verified: false, status: 'draft', propertyId: 'p2' }),
    lease({ leaseId: 'x1', expiryDate: '2026-12-01', status: 'draft' }),
  ]

  it('lists the verified monitored leases soonest first, with days, bucket and rental, never the unverified ones', () => {
    const report = buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF)
    expect(report.rows.map((row) => row.leaseId)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4'])
    expect(report.rows.map((row) => row.bucket)).toEqual(['expired', 'months_0_3', 'months_3_6', 'months_6_12', 'later'])
    expect(report.rows[0]).toMatchObject({ daysUntilExpiry: -20 })
    expect(report.rows[1]).toMatchObject({ daysUntilExpiry: 24, renewalOptionAvailable: true, openEventId: 'e1', noticeThreshold: 30 })
    expect(report.rows[2]).toMatchObject({ renewalOptionAvailable: false, noticeThreshold: 180 })
    expect(report.rows[3]).toMatchObject({ monthlyRental: 12500 })
    expect(report.rows[3]?.noticeThreshold).toBeUndefined()
    expect(report.expiredCount).toBe(1)
    expect(report.unverifiedLeasesExcluded).toBe(2)
    expect(report.noticeDays).toEqual([180, 90, 30])
  })

  it('totals every bucket in order, empty buckets included', () => {
    const report = buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF)
    expect(report.buckets).toEqual([
      { bucket: 'expired', count: 1, monthlyRental: 10000 },
      { bucket: 'months_0_3', count: 1, monthlyRental: 10000 },
      { bucket: 'months_3_6', count: 1, monthlyRental: 10000 },
      { bucket: 'months_6_12', count: 1, monthlyRental: 12500 },
      { bucket: 'later', count: 1, monthlyRental: 10000 },
    ])
  })

  it('counts within notice exactly the leases monitoring raises an expiry event for', () => {
    const report = buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF)
    const raised = LEASES.filter((row) => row.verified && shouldRaiseExpiryEvent(row, AS_OF, [180, 90, 30]) !== null)
    expect(report.withinNoticeCount).toBe(raised.length)
    expect(report.withinNoticeCount).toBe(2)
  })

  it('raises nothing within notice when the company switched the rule off', () => {
    const report = buildLeaseExpiryReport(LEASES, { ...SETTINGS, leaseExpiryNoticeDays: null }, AS_OF)
    expect(report.withinNoticeCount).toBe(0)
    expect(report.noticeDays).toEqual([])
    expect(report.rows.every((row) => row.noticeThreshold === undefined)).toBe(true)
  })

  it('narrows to properties, the expiry date range and expiry buckets', () => {
    expect(buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF, { propertyIds: ['p2'] })).toMatchObject({ rows: [{ leaseId: 'l4' }], unverifiedLeasesExcluded: 1 })
    const ranged = buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF, { from: '2026-12-15', to: '2027-04-30' })
    expect(ranged.rows.map((row) => row.leaseId)).toEqual(['l1', 'l2'])
    const soon = buildLeaseExpiryReport(LEASES, SETTINGS, AS_OF, { statuses: ['expired', 'months_0_3'] })
    expect(soon.rows.map((row) => row.leaseId)).toEqual(['l0', 'l1'])
    expect(soon.buckets.find((bucket) => bucket.bucket === 'later')?.count).toBe(0)
  })
})

describe('buildRenewalDeadlinesReport', () => {
  const option = (noticePeriodMonths: number | undefined, exercised = false) => ({
    exists: true,
    exercised,
    ...(noticePeriodMonths !== undefined ? { noticePeriodMonths } : {}),
  })
  const LEASES: LeaseDateRecord[] = [
    // Deadline 2027-09-30 (expiry 2027-12-31 less 3 months): open.
    lease({ leaseId: 'l1', expiryDate: '2027-12-31', renewalOption: option(3) }),
    // Deadline 2026-12-15: 24 days, due within 30.
    lease({ leaseId: 'l2', expiryDate: '2027-06-15', renewalOption: option(6), openRenewalEventId: 'e2' }),
    // Deadline 2026-10-31: passed.
    lease({ leaseId: 'l3', expiryDate: '2027-01-31', renewalOption: option(3) }),
    // Exercised: listed, no warning.
    lease({ leaseId: 'l4', expiryDate: '2027-02-28', renewalOption: option(3, true) }),
    // Deadline 2026-11-28: 7 days, due within 14.
    lease({ leaseId: 'l5', expiryDate: '2027-02-28', renewalOption: option(3), propertyId: 'p2', propertyName: 'Westgate' }),
    // No notice period recorded: no deadline.
    lease({ leaseId: 'l6', expiryDate: '2027-02-28', renewalOption: option(undefined) }),
    // No renewal option.
    lease({ leaseId: 'l7', expiryDate: '2027-02-28' }),
    // Unverified.
    lease({ leaseId: 'u1', expiryDate: '2027-02-28', renewalOption: option(3), verified: false, status: 'pending_verification' }),
  ]

  it('lists the notice deadlines of verified renewal options, soonest first, with days left and status', () => {
    const report = buildRenewalDeadlinesReport(LEASES, SETTINGS, AS_OF)
    expect(report.rows.map((row) => [row.leaseId, row.deadline, row.daysUntilDeadline, row.status])).toEqual([
      ['l3', '2026-10-31', -21, 'passed'],
      ['l4', '2026-11-28', 7, 'exercised'],
      ['l5', '2026-11-28', 7, 'due_critical'],
      ['l2', '2026-12-15', 24, 'due_soon'],
      ['l1', '2027-09-30', 313, 'open'],
    ])
    expect(report.rows.find((row) => row.leaseId === 'l2')).toMatchObject({ noticePeriodMonths: 6, openEventId: 'e2', warningThreshold: 30 })
    expect(report.countsByStatus).toEqual({ passed: 1, due_critical: 1, due_soon: 1, upcoming: 0, open: 1, exercised: 1 })
    expect(report.missingNoticePeriod).toBe(1)
    expect(report.unverifiedLeasesExcluded).toBe(1)
    expect(report.warningDays).toEqual([90, 60, 30])
  })

  it('counts requiring a warning exactly the leases monitoring raises a renewal-deadline event for', () => {
    const report = buildRenewalDeadlinesReport(LEASES, SETTINGS, AS_OF)
    const raised = leasesRequiringRenewalWarning(LEASES.filter((row) => row.verified), AS_OF, [90, 60, 30])
    expect(report.requiringWarning).toBe(raised.length)
    expect(report.rows.filter((row) => row.warningThreshold !== undefined).map((row) => row.leaseId).sort()).toEqual(raised.map((w) => w.lease.leaseId).sort())
    expect(buildRenewalDeadlinesReport(LEASES, { ...SETTINGS, renewalWarningDays: null }, AS_OF).requiringWarning).toBe(0)
  })

  it('narrows to properties, the deadline range and deadline statuses', () => {
    expect(buildRenewalDeadlinesReport(LEASES, SETTINGS, AS_OF, { propertyIds: ['p2'] }).rows.map((row) => row.leaseId)).toEqual(['l5'])
    expect(buildRenewalDeadlinesReport(LEASES, SETTINGS, AS_OF, { from: '2026-11-21', to: '2026-12-31' }).rows.map((row) => row.leaseId)).toEqual(['l4', 'l5', 'l2'])
    const urgent = buildRenewalDeadlinesReport(LEASES, SETTINGS, AS_OF, { statuses: ['due_critical', 'due_soon'] })
    expect(urgent.rows.map((row) => row.leaseId)).toEqual(['l5', 'l2'])
    expect(urgent.countsByStatus.passed).toBe(0)
  })
})

describe('REPORT_FILTER_SUPPORT for lease expiry and renewal deadlines', () => {
  it('offers the expiry buckets over the expiry date, and the deadline statuses over the notice deadline', () => {
    expect(REPORT_FILTER_SUPPORT.lease_expiry).toMatchObject({
      dateRange: { field: 'Expiry date' },
      statuses: { values: ['expired', 'months_0_3', 'months_3_6', 'months_6_12', 'later'] },
    })
    expect(REPORT_FILTER_SUPPORT.renewal_deadlines).toMatchObject({
      dateRange: { field: 'Notice deadline' },
      statuses: { values: ['passed', 'due_critical', 'due_soon', 'upcoming', 'open', 'exercised'] },
    })
    expect(reportFilterProblems('renewal_deadlines', { statuses: ['not_applicable'] })).toHaveLength(1)
    expect(reportFilterProblems('lease_expiry', { statuses: ['months_0_3'] })).toEqual([])
  })
})
