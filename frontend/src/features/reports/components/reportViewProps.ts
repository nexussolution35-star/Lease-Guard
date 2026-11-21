import type { UseQueryResult } from '@tanstack/react-query'
import type { ReportDefinition } from '@leaseguard/domain'

import { isAwaitingWorkspace } from '@/lib/data/queries'

import type { ReportSearch } from '../reportSearch'
import type { ReportFrameQuery } from './ReportFrame'

/** What the Reports page gives each report's view. */
export interface ReportViewProps {
  definition: ReportDefinition
  search: ReportSearch
  onSearchChange: (next: ReportSearch) => void
}

/** The frame's view of a report query. */
export function frameQueryOf(query: UseQueryResult<unknown>): ReportFrameQuery {
  return {
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    isAwaitingWorkspace: isAwaitingWorkspace(query),
    isRefreshing: query.isPlaceholderData,
    refetch: () => void query.refetch(),
  }
}
