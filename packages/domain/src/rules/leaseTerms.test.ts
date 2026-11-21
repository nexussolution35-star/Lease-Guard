import { describe, expect, it } from 'vitest'
import { makeLease } from './__fixtures__/lease.js'
import { changedLeaseTerms, editRequiresReverification, leaseStatusAfterTermChange } from './leaseTerms.js'
import { leaseStatusAfterVerification } from './monitoringWorkflow.js'

const guarantee = {
  bank: 'Standard Bank',
  referenceNumber: 'G-1',
  amount: 105000,
  basisMonths: 3,
  issuedOn: '2026-01-01',
  expiresOn: '2031-03-31',
  status: 'active',
} as const

describe('changedLeaseTerms', () => {
  const lease = makeLease({
    deposit: { amount: 70000, heldBy: 'landlord', interestBearing: true, receivedOn: '2025-12-15' },
    bankGuarantee: guarantee,
    notes: 'Filed',
  })

  it('names each changed term group, in form order', () => {
    const after = {
      ...lease,
      currentMonthlyRental: 37800,
      unitId: 'unit_other',
      bankGuarantee: { ...guarantee, expiresOn: '2032-03-31' },
    }
    expect(changedLeaseTerms(lease, after)).toEqual(['parties', 'rental', 'guarantee'])
  })

  it('treats escalation, renewal notice and deposit changes as term changes', () => {
    expect(changedLeaseTerms(lease, { ...lease, escalation: { ...lease.escalation, percentage: 7 } })).toEqual(['escalation'])
    expect(changedLeaseTerms(lease, { ...lease, renewalOption: { ...lease.renewalOption, noticePeriodMonths: 6 } })).toEqual(['renewal'])
    expect(changedLeaseTerms(lease, { ...lease, deposit: undefined })).toEqual(['deposit'])
    expect(changedLeaseTerms(lease, { ...lease, bankGuarantee: undefined })).toEqual(['guarantee'])
  })

  it('ignores the reference, notes, the deposit receipt date, renewal notes and the guarantee status', () => {
    const after = {
      ...lease,
      reference: 'TST-L002',
      notes: 'Moved',
      deposit: { ...lease.deposit!, receivedOn: '2026-01-05', notes: 'EFT' },
      renewalOption: { ...lease.renewalOption, notes: 'Tenant keen' },
      bankGuarantee: { ...guarantee, status: 'expiring' as const, notes: 'Original at office' },
    }
    expect(changedLeaseTerms(lease, after)).toEqual([])
  })

  it('compares an absent optional value and an undefined one as equal', () => {
    expect(changedLeaseTerms(lease, { ...lease, escalation: { ...lease.escalation, fixedAmount: undefined } })).toEqual([])
  })
})

describe('editRequiresReverification', () => {
  it('is true only for a verified lease whose terms change', () => {
    const verified = makeLease()
    expect(editRequiresReverification(verified, { ...verified, expiryDate: '2031-12-31' })).toBe(true)
    expect(editRequiresReverification(verified, { ...verified, notes: 'x' })).toBe(false)
    const unverified = makeLease({ verified: false, status: 'pending_verification' })
    expect(editRequiresReverification(unverified, { ...unverified, expiryDate: '2031-12-31' })).toBe(false)
  })
})

describe('leaseStatusAfterTermChange', () => {
  it('returns a lease in force to pending verification and keeps any other status', () => {
    expect(leaseStatusAfterTermChange('active')).toBe('pending_verification')
    expect(leaseStatusAfterTermChange('expiring')).toBe('pending_verification')
    for (const status of ['draft', 'pending_verification', 'expired', 'renewed', 'terminated'] as const) {
      expect(leaseStatusAfterTermChange(status)).toBe(status)
    }
  })

  it('is undone by verification', () => {
    expect(leaseStatusAfterVerification(leaseStatusAfterTermChange('active'))).toBe('active')
  })
})
