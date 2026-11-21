import { describe, expect, it } from 'vitest'

import { TEST_FILTER_ID, TEST_RECORD_ID } from '@/test/fakeApi'

import { hasReportFilters, reportFiltersFromSearch, reportSearchSchema } from './reportSearch'

describe('reportSearchSchema', () => {
  it('reads lists, drops invalid entries and never fails the route', () => {
    expect(reportSearchSchema.parse({ propertyId: [TEST_FILTER_ID, 'nope', TEST_FILTER_ID], status: 'vacant' })).toEqual({
      propertyId: [TEST_FILTER_ID],
      status: ['vacant'],
    })
    expect(reportSearchSchema.parse({ from: '2026-02-30', to: 7, status: ['DROP TABLE'] })).toEqual({})
  })
})

describe('reportFiltersFromSearch', () => {
  it('keeps only the filters and statuses the report offers', () => {
    const search = reportSearchSchema.parse({
      propertyId: [TEST_FILTER_ID, TEST_RECORD_ID],
      status: ['vacant', 'archived'],
      from: '2026-01-01',
    })
    expect(reportFiltersFromSearch('occupancy', search)).toEqual({ propertyIds: [TEST_FILTER_ID, TEST_RECORD_ID], statuses: ['vacant'] })
    expect(reportFiltersFromSearch('portfolio_overview', search)).toEqual({
      propertyIds: [TEST_FILTER_ID, TEST_RECORD_ID],
      statuses: ['archived'],
    })
  })

  it('tells whether a filter the report offers is set', () => {
    expect(hasReportFilters('occupancy', {})).toBe(false)
    expect(hasReportFilters('occupancy', reportSearchSchema.parse({ from: '2026-01-01' }))).toBe(false)
    expect(hasReportFilters('occupancy', reportSearchSchema.parse({ status: ['occupied'] }))).toBe(true)
  })
})
