import { describe, expect, it } from 'vitest'

import { REPORT_IDS } from '../types/reports.js'
import { appliedReportFilters, inReportProperties, inReportStatuses, REPORT_FILTER_SUPPORT, reportFilterProblems } from './reportFrame.js'

describe('REPORT_FILTER_SUPPORT', () => {
  it('describes the filters of every report, and every report can be narrowed to properties', () => {
    expect(Object.keys(REPORT_FILTER_SUPPORT).sort()).toEqual([...REPORT_IDS].sort())
    for (const id of REPORT_IDS) expect(REPORT_FILTER_SUPPORT[id].property, id).toBe(true)
  })

  it('offers property statuses on the portfolio overview and occupancy statuses on occupancy, both without a date range', () => {
    expect(REPORT_FILTER_SUPPORT.portfolio_overview).toMatchObject({ dateRange: null, statuses: { values: ['active', 'under_development', 'archived'] } })
    expect(REPORT_FILTER_SUPPORT.occupancy).toMatchObject({ dateRange: null, statuses: { values: ['occupied', 'vacant', 'under_offer', 'unavailable'] } })
  })
})

describe('REPORT_FILTER_SUPPORT for lease monitoring and rental discrepancies', () => {
  it('offers event statuses over the identified date, and the comparison outcome over the billing period', () => {
    expect(REPORT_FILTER_SUPPORT.lease_monitoring).toMatchObject({
      dateRange: { field: 'Identified' },
      statuses: { values: ['new', 'under_review', 'action_required', 'in_progress', 'resolved', 'dismissed'] },
    })
    expect(REPORT_FILTER_SUPPORT.rental_discrepancies).toMatchObject({
      dateRange: { field: 'Billing period' },
      statuses: { values: ['outside_tolerance', 'within_tolerance'] },
    })
    expect(reportFilterProblems('rental_discrepancies', { statuses: ['resolved'] })).toHaveLength(1)
    expect(reportFilterProblems('lease_monitoring', { from: '2026-02-01', to: '2026-01-01' })).toEqual(['to: the date range ends before it starts'])
  })
})

describe('reportFilterProblems', () => {
  it('refuses a status the report does not offer', () => {
    expect(reportFilterProblems('occupancy', { statuses: ['occupied'] })).toEqual([])
    expect(reportFilterProblems('occupancy', { statuses: ['archived'] })).toEqual([
      'status: "archived" is not offered by this report (Occupancy: occupied, vacant, under_offer, unavailable)',
    ])
  })

  it('ignores filters the report does not offer', () => {
    expect(reportFilterProblems('portfolio_overview', { from: 'not a date', to: '2026-01-01' })).toEqual([])
    expect(reportFilterProblems('occupancy', { from: '2026-02-01', to: '2026-01-01' })).toEqual([])
  })
})

describe('appliedReportFilters', () => {
  it('keeps only the filters the report offers, without repeats or empty lists', () => {
    expect(
      appliedReportFilters('occupancy', { propertyIds: ['p1', 'p1'], statuses: ['vacant', 'vacant'], from: '2026-01-01', to: '2026-02-01' }),
    ).toEqual({ propertyIds: ['p1'], statuses: ['vacant'] })
    expect(appliedReportFilters('portfolio_overview', { propertyIds: [], statuses: [] })).toEqual({})
  })
})

describe('inReportProperties / inReportStatuses', () => {
  it('passes every record without a filter and only the listed ones with one', () => {
    expect(inReportProperties({}, 'p1')).toBe(true)
    expect(inReportProperties({ propertyIds: ['p2'] }, 'p1')).toBe(false)
    expect(inReportStatuses({}, 'vacant')).toBe(true)
    expect(inReportStatuses({ statuses: ['occupied'] }, 'vacant')).toBe(false)
  })
})
