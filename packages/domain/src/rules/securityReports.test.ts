import { describe, expect, it } from 'vitest'

import { guaranteeCoverage } from './guarantee.js'
import { REPORT_FILTER_SUPPORT, reportFilterProblems } from './reportFrame.js'
import { buildDepositsGuaranteesReport, guaranteeNoticeDaysFor, securityRow, type LeaseSecurityRecord } from './securityReports.js'

const AS_OF = '2026-11-21'
const NOTICE = [90, 30]

/** R35 000 a month at 8% a year from 01 Mar 2026: R37 800 expected on the report date (PRD §5.7 D). */
const lease = (patch: Partial<LeaseSecurityRecord> & Pick<LeaseSecurityRecord, 'leaseId'>): LeaseSecurityRecord => ({
  reference: patch.leaseId.toUpperCase(),
  status: 'active',
  verified: true,
  tenantId: `${patch.leaseId}-tenant`,
  tenantName: `Tenant ${patch.leaseId}`,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  unitId: `${patch.leaseId}-unit`,
  unitNumber: 'S01',
  commencementDate: '2025-03-01',
  expiryDate: '2029-02-28',
  initialMonthlyRental: 35_000,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2026-03-01' },
  ...patch,
})

const guarantee = (patch: Partial<NonNullable<LeaseSecurityRecord['bankGuarantee']>> = {}): NonNullable<LeaseSecurityRecord['bankGuarantee']> => ({
  bank: 'Standard Bank',
  referenceNumber: 'BG-1',
  amount: 105_000,
  basisMonths: 3,
  issuedOn: '2025-03-01',
  expiresOn: '2029-05-31',
  status: 'active',
  ...patch,
})

const SHORT = lease({ leaseId: 'short', bankGuarantee: guarantee(), deposit: { amount: 70_000, basisMonths: 2, heldBy: 'landlord', interestBearing: true } })
const EXPIRING = lease({ leaseId: 'expiring', bankGuarantee: guarantee({ amount: 120_000, expiresOn: '2026-11-30' }) })
const EXPIRED = lease({ leaseId: 'expired', propertyId: 'p2', propertyName: 'Westgate', bankGuarantee: guarantee({ amount: 120_000, expiresOn: '2026-11-01' }) })
const DEPOSIT_ONLY = lease({ leaseId: 'deposit', deposit: { amount: 80_000, heldBy: 'managing_agent', interestBearing: false } })
const RELEASED = lease({ leaseId: 'released', bankGuarantee: guarantee({ status: 'released' }) })
const UNVERIFIED = lease({ leaseId: 'unverified', status: 'pending_verification', verified: false, bankGuarantee: guarantee({ expiresOn: '2026-11-30' }) })
const ENDED = lease({ leaseId: 'ended', status: 'terminated', verified: false, bankGuarantee: guarantee() })
const VERIFIED_DRAFT = lease({ leaseId: 'draft', status: 'renewed', bankGuarantee: guarantee() })

const RECORDS = [SHORT, EXPIRING, EXPIRED, DEPOSIT_ONLY, RELEASED, UNVERIFIED, ENDED, VERIFIED_DRAFT]

describe('securityRow', () => {
  it('works out the required cover and shortfall after escalation, the same figures as lease monitoring', () => {
    const row = securityRow(SHORT, AS_OF, NOTICE)
    expect(row).toMatchObject({
      expectedMonthlyRental: 37_800,
      guaranteeAmount: 105_000,
      guaranteeRequired: 113_400,
      guaranteeShortfall: 8_400,
      depositAmount: 70_000,
      depositBasisMonths: 2,
      depositRequired: 75_600,
      depositShortfall: 5_600,
      depositHeldBy: 'landlord',
      guaranteeState: 'active',
      needsAttention: true,
    })
    const coverage = guaranteeCoverage({ ...SHORT }, AS_OF)
    expect(row.guaranteeRequired).toBe(coverage?.required)
    expect(row.guaranteeShortfall).toBe(coverage?.shortfall)
  })

  it('marks a guarantee inside a notice threshold as expiring, and a passed date as expired', () => {
    expect(securityRow(EXPIRING, AS_OF, NOTICE)).toMatchObject({ guaranteeState: 'expiring', guaranteeDaysUntilExpiry: 9, guaranteeShortfall: 0, needsAttention: true })
    expect(securityRow(EXPIRED, AS_OF, NOTICE)).toMatchObject({ guaranteeState: 'expired', guaranteeDaysUntilExpiry: -20, needsAttention: true })
  })

  it('gives no required deposit without a basis, and no required guarantee once released', () => {
    const deposit = securityRow(DEPOSIT_ONLY, AS_OF, NOTICE)
    expect(deposit.depositRequired).toBeUndefined()
    expect(deposit).toMatchObject({ depositAmount: 80_000, depositShortfall: 0, guaranteeShortfall: 0, needsAttention: false })
    expect(deposit.guaranteeState).toBeUndefined()
    const released = securityRow(RELEASED, AS_OF, NOTICE)
    expect(released.guaranteeRequired).toBeUndefined()
    expect(released).toMatchObject({ guaranteeState: 'released', guaranteeShortfall: 0, needsAttention: false })
  })
})

describe('buildDepositsGuaranteesReport', () => {
  it('lists only verified, monitored leases and counts unverified leases that have not ended as excluded', () => {
    const report = buildDepositsGuaranteesReport(RECORDS, AS_OF, NOTICE)
    expect(report.rows.map((row) => row.leaseId)).toEqual(['short', 'expiring', 'expired', 'deposit', 'released'])
    expect(report.unverifiedLeasesExcluded).toBe(1)
    expect(report).toMatchObject({
      totalDeposits: 150_000,
      // Guarantees in force: the short one and the expiring one; expired and released are not held.
      totalGuarantees: 225_000,
      depositShortfallTotal: 5_600,
      guaranteeShortfallTotal: 8_400 + 0 + 0,
      leasesWithShortfall: 1,
      expiringGuarantees: 1,
      expiredGuarantees: 1,
      guaranteeNoticeDays: [90, 30],
    })
  })

  it('narrows to properties, guarantee states and the guarantee expiry range', () => {
    expect(buildDepositsGuaranteesReport(RECORDS, AS_OF, NOTICE, { propertyIds: ['p2'] }).rows.map((row) => row.leaseId)).toEqual(['expired'])
    const states = buildDepositsGuaranteesReport(RECORDS, AS_OF, NOTICE, { statuses: ['expiring', 'expired'] })
    expect(states.rows.map((row) => row.leaseId)).toEqual(['expiring', 'expired'])
    expect(states.totalDeposits).toBe(0)
    const range = buildDepositsGuaranteesReport(RECORDS, AS_OF, NOTICE, { from: '2026-11-01', to: '2026-12-31' })
    expect(range.rows.map((row) => row.leaseId)).toEqual(['expiring', 'expired'])
    // The property filter narrows the excluded count; the other filters do not.
    expect(buildDepositsGuaranteesReport(RECORDS, AS_OF, NOTICE, { propertyIds: ['p2'] }).unverifiedLeasesExcluded).toBe(0)
    expect(range.unverifiedLeasesExcluded).toBe(1)
  })

  it('is empty without leases', () => {
    expect(buildDepositsGuaranteesReport([], AS_OF, NOTICE)).toMatchObject({ rows: [], totalDeposits: 0, totalGuarantees: 0, leasesWithShortfall: 0 })
  })
})

describe('guaranteeNoticeDaysFor', () => {
  it('uses the rule\'s notice days when valid, else the company\'s, largest first', () => {
    expect(guaranteeNoticeDaysFor([30, 90])).toEqual([90, 30])
    expect(guaranteeNoticeDaysFor([90, 30], [60, 14, 60])).toEqual([60, 14])
    expect(guaranteeNoticeDaysFor([90, 30], [0, 10])).toEqual([90, 30])
    expect(guaranteeNoticeDaysFor([90, 30], null)).toEqual([90, 30])
  })
})

describe('deposits and guarantees filters', () => {
  it('offers properties, the guarantee expiry range and the guarantee states', () => {
    expect(REPORT_FILTER_SUPPORT.deposits_guarantees).toEqual({
      property: true,
      dateRange: { field: 'Guarantee expiry' },
      statuses: { label: 'Guarantee', values: ['active', 'expiring', 'expired', 'released', 'called'] },
    })
    expect(reportFilterProblems('deposits_guarantees', { statuses: ['vacant'] })).toHaveLength(1)
  })
})
