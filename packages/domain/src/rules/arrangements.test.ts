import { describe, expect, it } from 'vitest'
import { makeArrangement } from './__fixtures__/lease.js'
import {
  arrangementProgress,
  finalInstallmentDate,
  generateInstallmentSchedule,
  isArrangementActive,
  nextInstallment,
  overdueInstallments,
  shouldSuppressArrearsReminder,
} from './arrangements.js'

const today = '2026-11-06'

describe('generateInstallmentSchedule', () => {
  it('splits the balance with a remainder last instalment (monthly)', () => {
    const s = generateInstallmentSchedule({
      arrangementId: 'arr_1',
      outstandingBalance: 25000,
      installmentAmount: 10000,
      frequency: 'monthly',
      firstInstallmentDate: '2026-11-30',
    })
    expect(s.map((i) => i.amount)).toEqual([10000, 10000, 5000])
    expect(s.map((i) => i.dueDate)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30'])
    expect(s[0]).toMatchObject({ id: 'arr_1_inst_001', arrangementId: 'arr_1', sequence: 1, status: 'scheduled' })
    expect(finalInstallmentDate(s)).toBe('2027-01-30')
  })
  it('clamps monthly day-of-month at month end', () => {
    const s = generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 300, installmentAmount: 100, frequency: 'monthly', firstInstallmentDate: '2027-01-31' })
    expect(s.map((i) => i.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })
  it('weekly and fortnightly', () => {
    expect(generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 300, installmentAmount: 100, frequency: 'weekly', firstInstallmentDate: '2026-11-06' }).map((i) => i.dueDate)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20'])
    expect(generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 200, installmentAmount: 100, frequency: 'fortnightly', firstInstallmentDate: '2026-11-06' }).map((i) => i.dueDate)).toEqual(['2026-11-06', '2026-11-20'])
  })
  it('exact division and rounding', () => {
    expect(generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 1000, installmentAmount: 333.33, frequency: 'weekly', firstInstallmentDate: '2026-11-06' }).map((i) => i.amount)).toEqual([333.33, 333.33, 333.33, 0.01])
    expect(() => generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 0, installmentAmount: 100, frequency: 'weekly', firstInstallmentDate: '2026-11-06' })).toThrow()
    expect(() => generateInstallmentSchedule({ arrangementId: 'a', outstandingBalance: 100, installmentAmount: 0, frequency: 'weekly', firstInstallmentDate: '2026-11-06' })).toThrow()
  })
})

describe('isArrangementActive / shouldSuppressArrearsReminder', () => {
  it('status and date gates', () => {
    expect(isArrangementActive(makeArrangement(), today)).toBe(true)
    expect(isArrangementActive(makeArrangement({ status: 'proposed' }), today)).toBe(false)
    expect(isArrangementActive(makeArrangement({ status: 'completed' }), today)).toBe(false)
    expect(isArrangementActive(makeArrangement({ agreedOn: '2026-11-07' }), today)).toBe(false)
    expect(isArrangementActive(makeArrangement({ closedOn: '2026-11-06' }), today)).toBe(false)
  })
  it('suppresses only for the matching tenant with the flag set', () => {
    const arrs = [makeArrangement({ tenantId: 't1' }), makeArrangement({ id: 'arr_2', tenantId: 't2', suppressArrearsReminders: false })]
    expect(shouldSuppressArrearsReminder('t1', arrs, today)).toBe(true)
    expect(shouldSuppressArrearsReminder('t2', arrs, today)).toBe(false)
    expect(shouldSuppressArrearsReminder('t3', arrs, today)).toBe(false)
    expect(shouldSuppressArrearsReminder('t1', [makeArrangement({ tenantId: 't1', status: 'defaulted' })], today)).toBe(false)
  })
})

describe('instalment queries', () => {
  const arr = makeArrangement({
    installments: generateInstallmentSchedule({ arrangementId: 'arr_test', outstandingBalance: 40000, installmentAmount: 10000, frequency: 'monthly', firstInstallmentDate: '2026-09-15' }).map((i, idx) =>
      idx === 0 ? { ...i, status: 'confirmed_paid' as const } : i,
    ),
  })
  it('overdueInstallments honours grace days', () => {
    expect(overdueInstallments(arr, today).map((i) => i.dueDate)).toEqual(['2026-10-15'])
    expect(overdueInstallments(arr, today, 30)).toEqual([])
    expect(overdueInstallments(arr, '2026-11-15', 0)).toHaveLength(1)
    expect(overdueInstallments(arr, '2026-11-16', 0)).toHaveLength(2)
  })
  it('nextInstallment is the first open one on/after today', () => {
    expect(nextInstallment(arr, today)?.dueDate).toBe('2026-11-15')
    expect(nextInstallment(arr, '2026-11-15')?.dueDate).toBe('2026-11-15')
    expect(nextInstallment(arr, '2027-01-01')).toBeUndefined()
  })
  it('arrangementProgress', () => {
    expect(arrangementProgress(arr)).toEqual({ paid: 10000, remaining: 20000, paidCount: 1, totalCount: 4 })
  })
})
