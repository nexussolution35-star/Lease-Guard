import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  addMonthsISO,
  compareISODate,
  daysBetween,
  endOfMonthISO,
  formatSADate,
  formatSADateTime,
  isValidISODate,
  isWithinISO,
  isoToday,
  maxISODate,
  minISODate,
  parseISODate,
  startOfMonthISO,
  toISODate,
} from './dates'

describe('formatSADate', () => {
  it('formats the three SA styles', () => {
    expect(formatSADate('2026-11-06')).toBe('06 Nov 2026')
    expect(formatSADate('2026-11-06', 'short')).toBe('06 Nov 2026')
    expect(formatSADate('2026-11-06', 'long')).toBe('6 November 2026')
    expect(formatSADate('2026-11-06', 'numeric')).toBe('06/11/2026')
  })
  it('throws on malformed dates', () => {
    expect(() => formatSADate('06/11/2026')).toThrow()
  })
})

describe('formatSADateTime', () => {
  it('uses the wall clock as written', () => {
    expect(formatSADateTime('2026-11-06T08:30:00+02:00')).toBe('06 Nov 2026, 08:30')
    expect(formatSADateTime('2026-11-06T17:05:00+02:00', 'numeric')).toBe('06/11/2026, 17:05')
  })
})

describe('daysBetween', () => {
  it('is signed, calendar-based', () => {
    expect(daysBetween('2026-11-06', '2026-12-06')).toBe(30)
    expect(daysBetween('2026-12-06', '2026-11-06')).toBe(-30)
    expect(daysBetween('2026-11-06', '2026-11-06')).toBe(0)
    expect(daysBetween('2027-12-31', '2028-12-31')).toBe(366) // 2028 leap
  })
})

describe('addMonthsISO / addDaysISO', () => {
  it('clamps to month end', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsISO('2027-12-31', -3)).toBe('2027-09-30')
    expect(addMonthsISO('2026-01-01', 12)).toBe('2027-01-01')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('isValidISODate', () => {
  it('accepts real dates and rejects impossible or malformed ones', () => {
    expect(isValidISODate('2026-11-06')).toBe(true)
    expect(isValidISODate('2028-02-29')).toBe(true)
    expect(isValidISODate('2026-02-30')).toBe(false)
    expect(isValidISODate('2026-13-01')).toBe(false)
    expect(isValidISODate('2026-1-6')).toBe(false)
    expect(isValidISODate('')).toBe(false)
  })
})

describe('compare / min / max', () => {
  it('orders lexically', () => {
    expect(compareISODate('2026-01-01', '2026-01-02')).toBe(-1)
    expect(compareISODate('2026-01-02', '2026-01-01')).toBe(1)
    expect(compareISODate('2026-01-01', '2026-01-01')).toBe(0)
    expect(minISODate('2026-05-01', '2026-04-30')).toBe('2026-04-30')
    expect(maxISODate('2026-05-01', '2026-04-30')).toBe('2026-05-01')
    expect(isWithinISO('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithinISO('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false)
  })
})

describe('month bounds', () => {
  it('start and end of month', () => {
    expect(startOfMonthISO('2026-11-06')).toBe('2026-11-01')
    expect(endOfMonthISO('2026-11-06')).toBe('2026-11-30')
    expect(endOfMonthISO('2028-02-10')).toBe('2028-02-29')
  })
})

describe('Date bridges', () => {
  it('isoToday / toISODate / parseISODate use local calendar dates', () => {
    const d = new Date(2026, 10, 6, 23, 59)
    expect(isoToday(d)).toBe('2026-11-06')
    expect(toISODate(parseISODate('2026-11-06'))).toBe('2026-11-06')
    expect(parseISODate('2026-11-06').getDate()).toBe(6)
  })
})
