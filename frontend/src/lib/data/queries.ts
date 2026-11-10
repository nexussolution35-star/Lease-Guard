import { useQuery, type Query, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { useActiveCompanyId } from './useActiveCompanyId'

/**
 * A query scoped to the active company. Disabled (status `pending`, fetchStatus `idle`) while no
 * company is selected; `isAwaitingWorkspace` detects that state, and screens (e.g. `RecordQueryView`,
 * `PropertyListScreen`) render it as "no workspace" (`NoActiveWorkspace`).
 *
 * `keepPrevious` keeps the previous data visible while the next key loads (paging, sorting,
 * searching), but only within one company: after a workspace switch the query shows its loading
 * state rather than the previous company's records.
 */
export function useCompanyQuery<TData>(
  key: (companyId: EntityId) => QueryKey,
  fetcher: (companyId: EntityId) => Promise<TData>,
  options: {
    keepPrevious?: boolean
    enabled?: boolean
    /** Milliseconds, or decided from the latest data (e.g. poll only while something is pending). */
    refetchInterval?: number | ((query: Query<TData, Error, TData, QueryKey>) => number | false | undefined)
  } = {},
): UseQueryResult<TData> {
  const companyId = useActiveCompanyId()
  return useQuery({
    // Disabled without a company; the empty company id keeps keys distinct per entity and never fetches.
    queryKey: key(companyId ?? ''),
    queryFn: () => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return fetcher(companyId)
    },
    // Records which company a cached query belongs to, for `placeholderData` below.
    meta: { companyId },
    enabled: companyId !== null && (options.enabled ?? true),
    placeholderData: (previous, previousQuery) =>
      options.keepPrevious && previousQuery?.meta?.companyId === companyId ? previous : undefined,
    ...(options.refetchInterval ? { refetchInterval: options.refetchInterval } : {}),
  })
}

/** True when a query is waiting because no workspace is selected (it never ran). */
export function isAwaitingWorkspace(query: Pick<UseQueryResult<unknown>, 'isPending' | 'fetchStatus'>): boolean {
  return query.isPending && query.fetchStatus === 'idle'
}
