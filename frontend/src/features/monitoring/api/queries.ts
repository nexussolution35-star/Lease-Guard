import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, MonitoringEventListItem } from '@leaseguard/domain'

import { auditKeys } from '@/features/audit/api/queries'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getMonitoringEventSource } from './selectSource'
import type { MonitoringEventListParams, MonitoringEventStatusChange } from './source'

export const monitoringEventKeys = createEntityKeys('monitoringEvents')

export function useMonitoringEventList(params: MonitoringEventListParams): UseQueryResult<Page<MonitoringEventListItem>> {
  return useCompanyQuery(
    (companyId) => monitoringEventKeys.list(companyId, params),
    (companyId) => getMonitoringEventSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useMonitoringEventQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<MonitoringEventListItem | null> {
  return useCompanyQuery(
    (companyId) => monitoringEventKeys.detail(companyId, id),
    (companyId) => getMonitoringEventSource().get(companyId, id),
    options,
  )
}

/**
 * Moves one event to another status (writers). Stores the returned event in its detail cache, then refreshes every
 * monitoring list and detail (open counts and filters change) and the audit log, which holds the event's history.
 */
export function useUpdateMonitoringEventStatus(): UseMutationResult<
  MonitoringEventListItem,
  Error,
  { id: EntityId; change: MonitoringEventStatusChange }
> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: ({ id, change }) => getMonitoringEventSource().updateStatus(companyId(), id, change),
    onSuccess: (event) => queryClient.setQueryData(monitoringEventKeys.detail(event.companyId, event.id), event),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: monitoringEventKeys.all }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]),
  })
}
