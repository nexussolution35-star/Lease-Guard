import { describe, expect, it } from 'vitest'
import { makeLease } from './__fixtures__/lease.js'
import {
  appliedEscalationCount,
  buildEscalationCalculation,
  compareBilledRental,
  escalationDatesBetween,
  escalationRatePercent,
  escalationSchedule,
  expectedRental,
} from './escalation.js'

describe('escalationDatesBetween / appliedEscalationCount', () => {
  const lease = makeLease()
  it('lists annual dates inclusive and capped at expiry', () => {
    expect(escalationDatesBetween(lease, '2026-01-01', '2029-01-01')).toEqual(['2027-01-01', '2028-01-01', '2029-01-01'])
    expect(escalationDatesBetween(lease, '2027-06-01', '2028-06-01')).toEqual(['2028-01-01'])
    expect(escalationDatesBetween(lease, '2026-01-01', '2040-01-01')).toHaveLength(4) // 2027..2030, expiry 2030-12-31
    expect(escalationDatesBetween(lease, '2028-01-01', '2027-01-01')).toEqual([])
  })
  it('biennial and none', () => {
    const bi = makeLease({ escalation: { ...lease.escalation, frequency: 'biennial' } })
    expect(escalationDatesBetween(bi, '2026-01-01', '2030-12-31')).toEqual(['2027-01-01', '2029-01-01'])
    const none = makeLease({ escalation: { type: 'none', frequency: 'annual', firstEscalationDate: '2027-01-01' } })
    expect(escalationDatesBetween(none, '2026-01-01', '2030-12-31')).toEqual([])
  })
  it('counts applied escalations as of a date', () => {
    expect(appliedEscalationCount(lease, '2026-12-31')).toBe(0)
    expect(appliedEscalationCount(lease, '2027-01-01')).toBe(1)
    expect(appliedEscalationCount(lease, '2028-06-30')).toBe(2)
  })
})

describe('expectedRental', () => {
  it('spec example: R35 000 at 8% → R37 800 after first escalation, compounding thereafter', () => {
    const lease = makeLease()
    expect(expectedRental(lease, '2026-11-06')).toBe(35000)
    expect(expectedRental(lease, '2027-01-01')).toBe(37800)
    expect(expectedRental(lease, '2028-01-01')).toBe(40824)
    expect(expectedRental(lease, '2029-01-01')).toBe(44089.92)
  })
  it('fixed_amount adds per interval', () => {
    const lease = makeLease({ escalation: { type: 'fixed_amount', fixedAmount: 2500, frequency: 'annual', firstEscalationDate: '2027-01-01' } })
    expect(expectedRental(lease, '2028-03-01')).toBe(40000)
  })
  it('cpi_linked uses assumed + margin', () => {
    const lease = makeLease({
      escalation: { type: 'cpi_linked', cpiAssumedPercentage: 5, cpiMarginPercentage: 2, frequency: 'annual', firstEscalationDate: '2027-01-01' },
    })
    expect(escalationRatePercent(lease.escalation)).toBe(7)
    expect(expectedRental(lease, '2027-01-01')).toBe(37450)
  })
  it('none keeps initial rental', () => {
    const lease = makeLease({ escalation: { type: 'none', frequency: 'annual', firstEscalationDate: '2027-01-01' } })
    expect(expectedRental(lease, '2029-01-01')).toBe(35000)
  })
})

describe('buildEscalationCalculation', () => {
  it('produces human-readable steps', () => {
    const calc = buildEscalationCalculation(makeLease(), '2027-02-01')
    expect(calc.expectedAmount).toBe(37800)
    expect(calc.steps[0]).toBe('Initial rental R 35 000,00')
    expect(calc.steps[1]).toBe('Escalation 1 on 2027-01-01: R 35 000,00 × 1.08 = R 37 800,00')
    expect(calc.steps.at(-1)).toBe('Expected rental as of 2027-02-01: R 37 800,00')
  })
  it('notes when nothing has escalated yet', () => {
    const calc = buildEscalationCalculation(makeLease(), '2026-11-06')
    expect(calc.steps).toContain('No escalation effective on or before 2026-11-06')
  })
})

describe('compareBilledRental', () => {
  it('spec example: billed R35 000 vs expected R37 800 → R2 800 discrepancy', () => {
    const result = compareBilledRental(makeLease(), 35000, '2027-02-01', { toleranceRands: 50, tolerancePercent: 0.5 })
    expect(result).toMatchObject({ expected: 37800, billed: 35000, difference: 2800, withinTolerance: false })
    expect(result.calculation.actualAmount).toBe(35000)
    expect(result.calculation.difference).toBe(2800)
    expect(result.calculation.steps).toContain('Difference (expected − billed): R 2 800,00')
  })
  it('within tolerance by rands or percent', () => {
    expect(compareBilledRental(makeLease(), 37760, '2027-02-01', { toleranceRands: 50, tolerancePercent: 0 }).withinTolerance).toBe(true)
    expect(compareBilledRental(makeLease(), 37500, '2027-02-01', { toleranceRands: 0, tolerancePercent: 1 }).withinTolerance).toBe(true)
    expect(compareBilledRental(makeLease(), 37500, '2027-02-01').withinTolerance).toBe(false)
    expect(compareBilledRental(makeLease(), 37800, '2027-02-01').withinTolerance).toBe(true)
  })
  it('over-billing yields a negative difference', () => {
    expect(compareBilledRental(makeLease(), 40000, '2027-02-01').difference).toBe(-2200)
  })
})

describe('escalationSchedule', () => {
  it('lists the commencement rental and every escalation to expiry, marking the row in force', () => {
    const schedule = escalationSchedule(makeLease(), '2028-06-30')
    expect(schedule.map(({ effectiveDate, monthlyRental, increase }) => [effectiveDate, monthlyRental, increase])).toEqual([
      ['2026-01-01', 35000, 0],
      ['2027-01-01', 37800, 2800],
      ['2028-01-01', 40824, 3024],
      ['2029-01-01', 44089.92, 3265.92],
      ['2030-01-01', 47617.11, 3527.19],
    ])
    expect(schedule.map((row) => row.applied)).toEqual([true, true, true, false, false])
    expect(schedule.filter((row) => row.current).map((row) => row.step)).toEqual([2])
  })

  it('agrees with expectedRental on every escalation date', () => {
    const lease = makeLease({ escalation: { type: 'cpi_linked', cpiAssumedPercentage: 5, cpiMarginPercentage: 1.5, frequency: 'biennial', firstEscalationDate: '2027-03-01' } })
    for (const row of escalationSchedule(lease, '2026-01-01')) expect(row.monthlyRental).toBe(expectedRental(lease, row.effectiveDate))
  })

  it('adds the fixed amount per interval', () => {
    const lease = makeLease({ escalation: { type: 'fixed_amount', fixedAmount: 1500, frequency: 'annual', firstEscalationDate: '2027-01-01' } })
    expect(escalationSchedule(lease, '2026-01-01').map((row) => row.monthlyRental)).toEqual([35000, 36500, 38000, 39500, 41000])
  })

  it('has only the commencement row without an escalation clause, and nothing in force before commencement', () => {
    const lease = makeLease({ escalation: { type: 'none', frequency: 'annual', firstEscalationDate: '2027-01-01' } })
    expect(escalationSchedule(lease, '2025-12-31')).toEqual([
      { step: 0, effectiveDate: '2026-01-01', monthlyRental: 35000, increase: 0, applied: false, current: false },
    ])
  })
})
