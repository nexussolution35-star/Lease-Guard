import { describe, expect, it } from 'vitest'
import { makeLease } from './__fixtures__/lease'
import {
  appliedEscalationCount,
  buildEscalationCalculation,
  compareBilledRental,
  escalationDatesBetween,
  escalationRatePercent,
  expectedRental,
} from './escalation'

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
