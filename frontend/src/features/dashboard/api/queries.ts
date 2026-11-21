import type { UseQueryResult } from '@tanstack/react-query'
import type { DashboardSummary } from '@leaseguard/domain'

import { createEntityKeys } from '@/lib/data/queryKeys'
import { useCompanyQuery } from '@/lib/data/queries'

import { getDashboardSource } from './selectSource'

export const dashboardKeys = createEntityKeys('dashboard')

/** The summary's key, under the dashboard prefix of the active company. */
export const dashboardSummaryKey = (companyId: string) => [...dashboardKeys.company(companyId), 'summary'] as const

/**
 * Every dashboard figure of the active workspace in one request. Other screens' writes do not invalidate it; it is
 * stale after the query client's 30 seconds, so opening the dashboard again reads it afresh.
 */
export function useDashboardSummary(): UseQueryResult<DashboardSummary> {
  return useCompanyQuery(dashboardSummaryKey, (companyId) => getDashboardSource().summary(companyId))
}
