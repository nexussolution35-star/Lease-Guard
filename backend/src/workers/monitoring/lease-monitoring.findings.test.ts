import { describe, expect, it } from 'vitest'

import { LEASE, makeLease, MANAGER, names, rule, settings, STATEMENT } from '../workers.test-helpers'
import { type BilledRental, leaseFindings } from './lease-monitoring.findings'

const AS_OF = '2026-11-09'
const noBilling = new Map<string, BilledRental>()

describe('leaseFindings', () => {
  it('raises a lease expiry event at the threshold crossed, with a stable dedupe key', () => {
    const input = { leases: [makeLease({ expiryDate: '2027-01-31' })], billedRentals: noBilling, settings: settings(), names, asOf: AS_OF }
    const drafts = leaseFindings(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      dedupeKey: `lease_expiry:${LEASE}:2027-01-31:90`,
      type: 'lease_expiry',
      title: 'Lease expires in 83 days: Test Trading (Shop 1)',
      dueDate: '2027-01-31',
      priority: 'high',
      assignedToUserId: MANAGER,
      identifiedOn: AS_OF,
    })
    expect(leaseFindings(input).map((d) => d.dedupeKey)).toEqual(drafts.map((d) => d.dedupeKey))
  })

  it('ignores unverified leases and leases that are not monitored', () => {
    const leases = [
      makeLease({ expiryDate: '2027-01-31', verified: false }),
      makeLease({ expiryDate: '2027-01-31', status: 'pending_verification' }),
      makeLease({ expiryDate: '2027-01-31', status: 'terminated' }),
    ]
    expect(leaseFindings({ leases, billedRentals: noBilling, settings: settings(), names, asOf: AS_OF })).toEqual([])
  })

  it('honours a disabled rule and a rule that overrides the company notice days', () => {
    const lease = makeLease({ expiryDate: '2027-01-31' })
    const disabled = settings([rule({ event_type: 'lease_expiry', enabled: false, config: { kind: 'lease_expiry', noticeDays: [180, 90, 30] } })])
    expect(leaseFindings({ leases: [lease], billedRentals: noBilling, settings: disabled, names, asOf: AS_OF })).toEqual([])
    const only60 = settings([rule({ event_type: 'lease_expiry', config: { kind: 'lease_expiry', noticeDays: [60] } })])
    expect(leaseFindings({ leases: [lease], billedRentals: noBilling, settings: only60, names, asOf: AS_OF })).toEqual([])
  })

  it('raises a renewal notice warning from the domain deadline rule', () => {
    const lease = makeLease({
      expiryDate: '2027-06-30',
      renewalOption: { exists: true, noticePeriodMonths: 6, exercised: false },
    })
    const drafts = leaseFindings({ leases: [lease], billedRentals: noBilling, settings: settings(), names, asOf: AS_OF })
    expect(drafts).toEqual([
      expect.objectContaining({
        dedupeKey: `renewal_notice_deadline:${LEASE}:2026-12-30:60`,
        type: 'renewal_notice_deadline',
        dueDate: '2026-12-30',
        priority: 'medium',
      }),
    ])
  })

  it('raises guarantee expiry for expiring and expired guarantees, critical when close or past', () => {
    const guarantee = { bank: 'Test Bank', referenceNumber: 'TB-1', amount: 105000, basisMonths: 3, issuedOn: '2024-01-01', status: 'active' as const }
    const expiring = makeLease({ bankGuarantee: { ...guarantee, expiresOn: '2026-12-01' } })
    const expired = makeLease({ id: 'lease-2', bankGuarantee: { ...guarantee, expiresOn: '2026-11-01' } })
    const drafts = leaseFindings({ leases: [expiring, expired], billedRentals: noBilling, settings: settings(), names, asOf: AS_OF })
    const expiry = drafts.filter((d) => d.type === 'guarantee_expiry')
    expect(expiry.map((d) => [d.dedupeKey, d.priority])).toEqual([
      [`guarantee_expiry:${LEASE}:2026-12-01:30`, 'critical'],
      ['guarantee_expiry:lease-2:2026-11-01:expired', 'critical'],
    ])
    expect(expiry[1].title).toBe('Bank guarantee has expired: Test Bank TB-1')
  })

  it('raises a guarantee shortfall against the escalated rental, with an explainable calculation', () => {
    const lease = makeLease({
      bankGuarantee: { bank: 'Test Bank', referenceNumber: 'TB-1', amount: 105000, basisMonths: 3, issuedOn: '2026-01-01', expiresOn: '2029-01-01', status: 'active' },
    })
    const rules = settings([rule({ event_type: 'guarantee_shortfall', default_priority: 'high', config: { kind: 'guarantee_shortfall', minimumCoverageMonths: 3, toleranceRands: 1000 } })])
    const drafts = leaseFindings({ leases: [lease], billedRentals: noBilling, settings: rules, names, asOf: '2027-02-01' })
    const shortfall = drafts.find((d) => d.type === 'guarantee_shortfall')
    expect(shortfall).toMatchObject({
      dedupeKey: `guarantee_shortfall:${LEASE}:113400.00:105000.00`,
      priority: 'high',
      ruleId: 'rule-guarantee_shortfall',
      calculation: { expectedAmount: 113400, actualAmount: 105000, difference: 8400 },
    })
    expect(shortfall?.calculation?.steps.at(-1)).toBe('Shortfall: R 8 400,00')
  })

  it('raises a deposit shortfall below the basis months unless a rule accepts less cover', () => {
    const lease = makeLease({ deposit: { amount: 35000, basisMonths: 2, heldBy: 'landlord', interestBearing: false } })
    const byDefault = leaseFindings({ leases: [lease], billedRentals: noBilling, settings: settings(), names, asOf: AS_OF })
    expect(byDefault.filter((d) => d.type === 'deposit_shortfall')).toHaveLength(1)
    const oneMonth = settings([rule({ event_type: 'deposit_shortfall', config: { kind: 'deposit_shortfall', minimumCoverageMonths: 1 } })])
    expect(leaseFindings({ leases: [lease], billedRentals: noBilling, settings: oneMonth, names, asOf: AS_OF })).toEqual([])
  })

  it('compares the billed rental of the latest verified statement with the verified lease terms', () => {
    const billed = new Map<string, BilledRental>([[LEASE, { statementId: STATEMENT, periodStart: '2027-01-01', rentalCharged: 35000 }]])
    const rules = settings([
      rule({ event_type: 'rental_escalation_discrepancy', default_priority: 'high', config: { kind: 'rental_escalation_discrepancy', toleranceRands: 50, tolerancePercent: 0.5 } }),
    ])
    const drafts = leaseFindings({ leases: [makeLease()], billedRentals: billed, settings: rules, names, asOf: AS_OF })
    expect(drafts).toEqual([
      expect.objectContaining({
        dedupeKey: `rental_escalation_discrepancy:${STATEMENT}`,
        statementId: STATEMENT,
        title: 'Rental under-charged: Test Trading (Shop 1)',
        calculation: expect.objectContaining({ expectedAmount: 37800, actualAmount: 35000, difference: 2800 }),
      }),
    ])
    const withinTolerance = new Map<string, BilledRental>([[LEASE, { statementId: STATEMENT, periodStart: '2027-01-01', rentalCharged: 37790 }]])
    expect(leaseFindings({ leases: [makeLease()], billedRentals: withinTolerance, settings: rules, names, asOf: AS_OF })).toEqual([])
  })

  it('assigns events to the rule default assignee when one is configured', () => {
    const rules = settings([rule({ event_type: 'lease_expiry', default_assignee_user_id: 'assignee-1', config: { kind: 'lease_expiry', noticeDays: [90] } })])
    const [draft] = leaseFindings({ leases: [makeLease({ expiryDate: '2027-01-31' })], billedRentals: noBilling, settings: rules, names, asOf: AS_OF })
    expect(draft.assignedToUserId).toBe('assignee-1')
  })
})
