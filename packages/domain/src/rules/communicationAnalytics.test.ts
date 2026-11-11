import { describe, expect, it } from 'vitest'

import {
  COMMUNICATION_ANALYTICS_MAX_DAYS,
  communicationAnalyticsRangeProblem,
  defaultCommunicationAnalyticsRange,
  formatCount,
  shareOf,
} from './communicationAnalytics.js'

describe('defaultCommunicationAnalyticsRange', () => {
  it('is the last 30 days, today included', () => {
    expect(defaultCommunicationAnalyticsRange('2026-11-11')).toEqual({ from: '2026-10-13', to: '2026-11-11' })
  })

  it('crosses a year end', () => {
    expect(defaultCommunicationAnalyticsRange('2027-01-05')).toEqual({ from: '2026-12-07', to: '2027-01-05' })
  })
})

describe('communicationAnalyticsRangeProblem', () => {
  it('accepts a single day and a range of at most a year', () => {
    expect(COMMUNICATION_ANALYTICS_MAX_DAYS).toBe(366)
    expect(communicationAnalyticsRangeProblem({ from: '2026-11-11', to: '2026-11-11' })).toBeUndefined()
    // 2024 is a leap year: 1 Jan to 31 Dec is 366 days.
    expect(communicationAnalyticsRangeProblem({ from: '2024-01-01', to: '2024-12-31' })).toBeUndefined()
  })

  it('refuses an end before the start', () => {
    expect(communicationAnalyticsRangeProblem({ from: '2026-11-11', to: '2026-11-10' })).toBe('The end date must be on or after the start date.')
  })

  it('refuses more than 366 days', () => {
    expect(communicationAnalyticsRangeProblem({ from: '2024-01-01', to: '2025-01-01' })).toBe('Choose a range of at most 366 days.')
  })

  it('refuses dates that are not calendar dates', () => {
    expect(communicationAnalyticsRangeProblem({ from: '2026-02-30', to: '2026-03-01' })).toBe('Enter dates as YYYY-MM-DD.')
  })
})

describe('shareOf', () => {
  it('is a whole percentage, rounded', () => {
    expect(shareOf(2, 3)).toBe(67)
    expect(shareOf(3, 3)).toBe(100)
    expect(shareOf(0, 4)).toBe(0)
  })

  it('is undefined when there is nothing to share', () => {
    expect(shareOf(0, 0)).toBeUndefined()
  })
})

describe('formatCount', () => {
  it('groups thousands with regular spaces, South African style', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(950)).toBe('950')
    expect(formatCount(1250)).toBe('1 250')
    expect(formatCount(1234567)).toBe('1 234 567')
  })
})
