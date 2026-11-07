import { describe, expect, it } from 'vitest'
import type { BankGuarantee } from '@/types'
import { makeLease } from './__fixtures__/lease'
import { depositCoverage, guaranteeCoverage, guaranteeExpiryStatus, requiredGuaranteeAmount } from './guarantee'

const guarantee: BankGuarantee = {
  bank: 'Standard Bank',
  referenceNumber: 'BG-001',
  amount: 105000,
  basisMonths: 3,
  issuedOn: '2026-01-01',
  expiresOn: '2027-01-31',
  status: 'active',
}

describe('requiredGuaranteeAmount / guaranteeCoverage', () => {
  it('scales the requirement with escalated rental', () => {
    const lease = makeLease({ bankGuarantee: guarantee })
    expect(requiredGuaranteeAmount(lease, '2026-11-06')).toBe(105000)
    expect(requiredGuaranteeAmount(lease, '2027-01-01')).toBe(113400)
    expect(requiredGuaranteeAmount(makeLease(), '2027-01-01')).toBeNull()
    expect(requiredGuaranteeAmount(makeLease(), '2027-01-01', 2)).toBe(75600)
  })
  it('reports shortfall after escalation', () => {
    const lease = makeLease({ bankGuarantee: guarantee })
    expect(guaranteeCoverage(lease, '2026-11-06')).toMatchObject({ required: 105000, actual: 105000, shortfall: 0, coverageMonths: 3, coverageRatio: 1 })
    const after = guaranteeCoverage(lease, '2027-01-01')
    expect(after).toMatchObject({ required: 113400, actual: 105000, shortfall: 8400, expectedMonthlyRental: 37800 })
    expect(after?.coverageMonths).toBe(2.78)
    expect(after?.coverageRatio).toBeCloseTo(0.9259, 4)
    expect(guaranteeCoverage(makeLease(), '2027-01-01')).toBeNull()
  })
})

describe('depositCoverage', () => {
  it('uses deposit.basisMonths', () => {
    const lease = makeLease({ deposit: { amount: 70000, basisMonths: 2, heldBy: 'managing_agent', interestBearing: true } })
    expect(depositCoverage(lease, '2027-01-01')).toMatchObject({ required: 75600, actual: 70000, shortfall: 5600, basisMonths: 2 })
    expect(depositCoverage(makeLease({ deposit: { amount: 70000, heldBy: 'landlord', interestBearing: false } }), '2027-01-01')).toBeNull()
    expect(depositCoverage(makeLease(), '2027-01-01')).toBeNull()
  })
})

describe('guaranteeExpiryStatus', () => {
  const notice = [90, 30]
  it('active, expiring, expired', () => {
    expect(guaranteeExpiryStatus(guarantee, '2026-06-01', notice)).toMatchObject({ state: 'active', thresholdCrossed: null })
    expect(guaranteeExpiryStatus(guarantee, '2026-11-06', notice)).toMatchObject({ state: 'expiring', daysUntilExpiry: 86, thresholdCrossed: 90 })
    expect(guaranteeExpiryStatus(guarantee, '2027-01-15', notice)).toMatchObject({ state: 'expiring', thresholdCrossed: 30 })
    expect(guaranteeExpiryStatus(guarantee, '2027-02-01', notice)).toMatchObject({ state: 'expired', daysUntilExpiry: -1 })
  })
  it('released and called are terminal', () => {
    expect(guaranteeExpiryStatus({ ...guarantee, status: 'released' }, '2026-11-06', notice).state).toBe('released')
    expect(guaranteeExpiryStatus({ ...guarantee, status: 'called' }, '2027-03-01', notice).state).toBe('called')
  })
})
