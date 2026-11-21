import { describe, expect, it } from 'vitest'

import type { ArrangementInstallment } from '../types/index.js'
import {
  arrangementActions,
  arrangementTermsProblems,
  arrearsForArrangementLease,
  generateInstallmentSchedule,
  installmentOutcomeProblem,
  installmentShortfallsOnStatements,
  isArrangementClosed,
  previewInstallmentSchedule,
  type ArrangementStatementFigures,
} from './arrangements.js'

const TODAY = '2026-11-21'

function terms(overrides: Partial<Parameters<typeof arrangementTermsProblems>[0]> = {}) {
  return {
    outstandingBalance: 10_000,
    installmentAmount: 3_000,
    frequency: 'monthly' as const,
    firstInstallmentDate: '2026-01-31',
    agreedOn: '2026-01-15',
    ...overrides,
  }
}

describe('arrangementTermsProblems', () => {
  it('accepts terms that fit, with or without the final date of their schedule', () => {
    expect(arrangementTermsProblems(terms(), TODAY)).toEqual([])
    expect(arrangementTermsProblems(terms({ finalInstallmentDate: '2026-04-30' }), TODAY)).toEqual([])
  })

  it('words every problem the database words', () => {
    expect(arrangementTermsProblems(terms({ finalInstallmentDate: '2026-03-31' }), TODAY)).toEqual([
      'The final instalment of this schedule is due on 30 Apr 2026 (4 instalments), not 31 Mar 2026.',
    ])
    expect(arrangementTermsProblems(terms({ outstandingBalance: 100, installmentAmount: 200 }), TODAY)).toEqual([
      'The instalment amount cannot be more than the outstanding balance.',
    ])
    expect(arrangementTermsProblems(terms({ installmentAmount: 0 }), TODAY)).toEqual(['The instalment amount must be more than R 0,00.'])
    expect(arrangementTermsProblems(terms({ outstandingBalance: -1 }), TODAY)).toEqual(['The outstanding balance must be more than R 0,00.'])
    expect(arrangementTermsProblems(terms({ firstInstallmentDate: '2026-01-01', agreedOn: '2026-02-01' }), TODAY)).toEqual([
      'The first instalment cannot be before the agreement date (01 Feb 2026).',
    ])
    expect(arrangementTermsProblems(terms({ agreedOn: '2026-11-22', firstInstallmentDate: '2026-12-01' }), TODAY)).toEqual([
      'The agreement date cannot be in the future.',
    ])
    expect(arrangementTermsProblems(terms({ outstandingBalance: 1000, installmentAmount: 3, frequency: 'weekly' }), TODAY)).toEqual([
      'This schedule has 334 instalments; at most 260 are allowed. Raise the instalment amount.',
    ])
  })

  it('checks the final date against the same schedule generateInstallmentSchedule builds', () => {
    const schedule = generateInstallmentSchedule({
      arrangementId: 'a',
      outstandingBalance: 300,
      installmentAmount: 100,
      frequency: 'fortnightly',
      firstInstallmentDate: '2026-11-02',
    })
    const final = schedule.at(-1)?.dueDate
    expect(final).toBe('2026-11-30')
    expect(
      arrangementTermsProblems(
        { outstandingBalance: 300, installmentAmount: 100, frequency: 'fortnightly', firstInstallmentDate: '2026-11-02', finalInstallmentDate: final, agreedOn: '2026-11-01' },
        TODAY,
      ),
    ).toEqual([])
  })
})

function instalment(sequence: number, dueDate: string, status: ArrangementInstallment['status'] = 'scheduled', amount = 2_000): ArrangementInstallment {
  return { id: `i${sequence}`, arrangementId: 'a', sequence, dueDate, amount, status }
}

describe('arrangementActions', () => {
  it('follows the status workflow', () => {
    expect(arrangementActions({ status: 'proposed', installments: [instalment(1, '2026-12-01')] })).toEqual({
      edit: true,
      activate: true,
      close: false,
      cancel: true,
      editSchedule: true,
      recordInstallmentOutcomes: false,
    })
    expect(arrangementActions({ status: 'active', installments: [instalment(1, '2026-10-01', 'missed')] })).toMatchObject({
      activate: false,
      close: true,
      cancel: true,
      editSchedule: false,
      recordInstallmentOutcomes: true,
    })
    expect(arrangementActions({ status: 'active', installments: [instalment(1, '2026-10-01', 'reminder_sent')] }).editSchedule).toBe(true)
    for (const status of ['completed', 'defaulted', 'cancelled'] as const) {
      expect(isArrangementClosed({ status })).toBe(true)
      expect(Object.values(arrangementActions({ status, installments: [] })).some(Boolean)).toBe(false)
    }
    expect(isArrangementClosed({ status: 'active' })).toBe(false)
  })
})

describe('installmentOutcomeProblem', () => {
  it('records outcomes only on an active arrangement, and a future instalment cannot be missed', () => {
    const future = instalment(3, '2026-12-01')
    expect(installmentOutcomeProblem({ status: 'active' }, future, 'confirmed_paid', TODAY)).toBeNull()
    expect(installmentOutcomeProblem({ status: 'active' }, future, 'missed', TODAY)).toBe(
      'Instalment 3 is due on 01 Dec 2026, so it cannot be missed yet.',
    )
    expect(installmentOutcomeProblem({ status: 'active' }, instalment(1, TODAY), 'missed', TODAY)).toBeNull()
    expect(installmentOutcomeProblem({ status: 'cancelled' }, future, 'waived', TODAY)).toBe(
      'Instalment outcomes are recorded while the arrangement is active; this one is cancelled.',
    )
  })
})

describe('installmentShortfallsOnStatements', () => {
  const statement = (overrides: Partial<ArrangementStatementFigures> = {}): ArrangementStatementFigures => ({
    id: 's-oct',
    leaseId: 'lease',
    status: 'verified',
    statementDate: '2026-10-31',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    rentalCharged: 12_000,
    additionalCharges: 500,
    paymentsReceived: 12_500,
    ...overrides,
  })
  const arrangement = {
    leaseId: 'lease',
    installments: [instalment(1, '2026-09-15', 'confirmed_paid'), instalment(2, '2026-10-15'), instalment(3, '2026-11-15')],
  }

  it('flags an open instalment when the payments received do not cover the charges plus the instalments due', () => {
    expect(installmentShortfallsOnStatements(arrangement, [statement()])).toEqual([
      {
        installment: arrangement.installments[1],
        statementId: 's-oct',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        rentalCharged: 12_000,
        additionalCharges: 500,
        installmentsDue: 2_000,
        expected: 14_500,
        paymentsReceived: 12_500,
        shortfall: 2_000,
      },
    ])
  })

  it('raises nothing when the payments cover the period', () => {
    expect(installmentShortfallsOnStatements(arrangement, [statement({ paymentsReceived: 14_500 })])).toEqual([])
  })

  it('ignores statements that are not verified, of another lease, or missing a figure or the period (nothing is guessed)', () => {
    expect(
      installmentShortfallsOnStatements(arrangement, [
        statement({ status: 'review_required' }),
        statement({ leaseId: 'other' }),
        statement({ paymentsReceived: undefined }),
        statement({ periodStart: undefined }),
      ]),
    ).toEqual([])
  })

  it('never flags an instalment already recorded, and the latest statement covering it decides', () => {
    const recorded = { leaseId: 'lease', installments: [instalment(2, '2026-10-15', 'missed')] }
    expect(installmentShortfallsOnStatements(recorded, [statement()])).toEqual([])
    const corrected = statement({ id: 's-oct-2', statementDate: '2026-11-02', paymentsReceived: 14_500 })
    expect(installmentShortfallsOnStatements(arrangement, [statement(), corrected])).toEqual([])
  })
})

describe('previewInstallmentSchedule', () => {
  it('is the schedule the database generates: the agreed amount, then the remainder', () => {
    const schedule = previewInstallmentSchedule(terms())
    expect(schedule.map((i) => [i.sequence, i.dueDate, i.amount])).toEqual([
      [1, '2026-01-31', 3_000],
      [2, '2026-02-28', 3_000],
      [3, '2026-03-31', 3_000],
      [4, '2026-04-30', 1_000],
    ])
    expect(schedule.every((i) => i.status === 'scheduled')).toBe(true)
  })

  it('is empty while the terms cannot be scheduled, never throwing', () => {
    expect(previewInstallmentSchedule(terms({ installmentAmount: 0 }))).toEqual([])
    expect(previewInstallmentSchedule(terms({ outstandingBalance: Number.NaN }))).toEqual([])
    expect(previewInstallmentSchedule(terms({ installmentAmount: 20_000 }))).toEqual([])
    expect(previewInstallmentSchedule(terms({ outstandingBalance: 1_000_000, installmentAmount: 1 }))).toEqual([])
  })
})

describe('arrearsForArrangementLease', () => {
  const entries = [
    { tenantId: 't1', leaseId: 'l1', outstanding: 12_000, statementDate: '2026-11-01' },
    { tenantId: 't1', leaseId: 'l2', outstanding: 0, statementDate: '2026-11-01' },
    { tenantId: 't2', leaseId: 'l3', outstanding: 5_000, statementDate: '2026-11-01' },
  ]

  it("is the lease's latest verified balance for that tenant", () => {
    expect(arrearsForArrangementLease(entries, 't1', 'l1')?.outstanding).toBe(12_000)
  })

  it('is undefined without a balance on that lease, or for another tenant', () => {
    expect(arrearsForArrangementLease(entries, 't1', 'l2')).toBeUndefined()
    expect(arrearsForArrangementLease(entries, 't1', 'l3')).toBeUndefined()
    expect(arrearsForArrangementLease(entries, 't3', 'l9')).toBeUndefined()
  })
})
