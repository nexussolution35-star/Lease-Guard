import { describe, expect, it } from 'vitest'
import { formatZAR, parseZAR, roundZar, sumZar } from './money.js'

describe('roundZar', () => {
  it('rounds to 2dp and fixes float noise', () => {
    expect(roundZar(37800.004)).toBe(37800)
    expect(roundZar(1.005)).toBe(1.01)
    expect(roundZar(0.1 + 0.2)).toBe(0.3)
    expect(roundZar(-1.005)).toBe(-1.01)
  })
  it('normalises -0 and non-finite', () => {
    expect(Object.is(roundZar(-0.001), 0)).toBe(true)
    expect(roundZar(Number.NaN)).toBe(0)
  })
})

describe('sumZar', () => {
  it('sums and rounds once', () => {
    expect(sumZar([0.1, 0.2, 0.3])).toBe(0.6)
    expect(sumZar([])).toBe(0)
    expect(sumZar([35000, 2800])).toBe(37800)
  })
})

describe('formatZAR', () => {
  it('formats en-ZA with regular spaces and comma decimals', () => {
    expect(formatZAR(37800)).toBe('R 37 800,00')
    expect(formatZAR(35000)).toBe('R 35 000,00')
    expect(formatZAR(1234567.5)).toBe('R 1 234 567,50')
    expect(formatZAR(0)).toBe('R 0,00')
    expect(formatZAR(999.999)).toBe('R 1 000,00')
  })
  it('formats negatives with a leading minus', () => {
    expect(formatZAR(-1200)).toBe('-R 1 200,00')
  })
  it('omits the symbol when asked', () => {
    expect(formatZAR(37800, { withSymbol: false })).toBe('37 800,00')
  })
  it('compact notation', () => {
    expect(formatZAR(1250000, { compact: true })).toBe('R 1,3M')
    expect(formatZAR(37800, { compact: true })).toBe('R 37,8K')
  })
})

describe('parseZAR', () => {
  it('parses accounting-system strings', () => {
    expect(parseZAR('R35,000.00')).toBe(35000)
    expect(parseZAR('R 35 000,00')).toBe(35000)
    expect(parseZAR('R 37 800,00')).toBe(37800)
    expect(parseZAR('35000')).toBe(35000)
    expect(parseZAR('R1,200')).toBe(1200)
    expect(parseZAR('1.200,50')).toBe(1200.5)
    expect(parseZAR('ZAR 12 345.6')).toBe(12345.6)
  })
  it('parses negatives: parentheses, minus, CR', () => {
    expect(parseZAR('(1 200,00)')).toBe(-1200)
    expect(parseZAR('-R 1 200,00')).toBe(-1200)
    expect(parseZAR('R 500,00 CR')).toBe(-500)
  })
  it('returns null for non-numeric input', () => {
    expect(parseZAR('')).toBeNull()
    expect(parseZAR('n/a')).toBeNull()
    expect(parseZAR('R')).toBeNull()
  })
  it('round-trips formatZAR output', () => {
    for (const n of [0, 12.34, 37800, -1200, 9876543.21]) expect(parseZAR(formatZAR(n))).toBe(n)
  })
})
