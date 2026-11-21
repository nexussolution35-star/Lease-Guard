import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, forbiddenFetch, requestAt, TEST_COMPANY_ID, TEST_FILTER_ID, urlOf } from '@/test/fakeApi'

import { createApiReportsSource, reportQueryOf } from './apiSource'

const envelope = {
  reportId: 'occupancy',
  asOf: '2026-11-21',
  filters: { statuses: ['vacant'] },
  data: { totals: { total: 0 }, byProperty: [], byUnitType: [], units: [] },
}

describe('createApiReportsSource', () => {
  it('reads the catalogue for the explicit company', async () => {
    const fetch = fakeFetch(200, { reports: [{ id: 'occupancy', title: 'Occupancy', description: 'Units', icon: 'door-open' }] })
    const reports = await createApiReportsSource(fakeApiClient(fetch)).catalogue(TEST_COMPANY_ID)
    expect(reports.map((report) => report.id)).toEqual(['occupancy'])
    expect(urlOf(fetch).pathname).toBe('/api/v1/reports')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('reads a report at /api/v1/reports/{reportId} with repeated filter parameters', async () => {
    const fetch = fakeFetch(200, envelope)
    const report = await createApiReportsSource(fakeApiClient(fetch)).report(TEST_COMPANY_ID, 'occupancy', {
      propertyIds: [TEST_FILTER_ID],
      statuses: ['vacant', 'under_offer'],
    })
    expect(report).toEqual(envelope)
    const url = new URL(requestAt(fetch).url)
    expect(url.pathname).toBe('/api/v1/reports/occupancy')
    expect(url.searchParams.getAll('status')).toEqual(['vacant', 'under_offer'])
    expect(url.searchParams.getAll('propertyId')).toEqual([TEST_FILTER_ID])
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('sends no filter parameters without filters, and surfaces API errors', async () => {
    const fetch = fakeFetch(200, { ...envelope, reportId: 'portfolio_overview' })
    await createApiReportsSource(fakeApiClient(fetch)).report(TEST_COMPANY_ID, 'portfolio_overview', {})
    expect(urlOf(fetch)).toEqual({ pathname: '/api/v1/reports/portfolio_overview', query: {} })
    await expect(createApiReportsSource(fakeApiClient(forbiddenFetch())).report(TEST_COMPANY_ID, 'occupancy', {})).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('reportQueryOf', () => {
  it('leaves out empty filters', () => {
    expect(reportQueryOf({ propertyIds: [], statuses: [] })).toEqual({})
    expect(reportQueryOf({ from: '2026-01-01' })).toEqual({ from: '2026-01-01' })
  })
})
