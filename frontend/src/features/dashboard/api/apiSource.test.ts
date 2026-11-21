import type { DashboardSummary } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, forbiddenFetch, requestAt, TEST_COMPANY_ID, urlOf } from '@/test/fakeApi'

import { createApiDashboardSource } from './apiSource'

const summary: DashboardSummary = {
  asOf: '2026-11-21',
  properties: 4,
  units: 30,
  occupiedUnits: 21,
  activeLeases: 19,
  totalOutstanding: 16_500.5,
  tenantsInArrears: 2,
  activeArrangements: 1,
  escalationDiscrepancies: 1,
  upcomingExpiries: 3,
  renewalDeadlines: 2,
  expiringGuarantees: 0,
  pendingStatementReviews: 3,
  pendingApprovals: 5,
}

describe('createApiDashboardSource', () => {
  it('reads the summary for the explicit company', async () => {
    const fetch = fakeFetch(200, summary)
    expect(await createApiDashboardSource(fakeApiClient(fetch)).summary(TEST_COMPANY_ID)).toEqual(summary)
    expect(urlOf(fetch).pathname).toBe('/api/v1/dashboard/summary')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('surfaces API errors', async () => {
    await expect(createApiDashboardSource(fakeApiClient(forbiddenFetch())).summary(TEST_COMPANY_ID)).rejects.toMatchObject({ status: 403 })
  })
})
