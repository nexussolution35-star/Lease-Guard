import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, MonitoringEvent } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getMonitoringEventSource } from './selectSource'
import type { MonitoringEventListParams } from './source'

export const monitoringEventKeys = createEntityKeys('monitoringEvents')

export function useMonitoringEventList(params: MonitoringEventListParams): UseQueryResult<Page<MonitoringEvent>> {
  return useCompanyQuery(
    (companyId) => monitoringEventKeys.list(companyId, params),
    (companyId) => getMonitoringEventSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useMonitoringEventQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<MonitoringEvent | null> {
  return useCompanyQuery(
    (companyId) => monitoringEventKeys.detail(companyId, id),
    (companyId) => getMonitoringEventSource().get(companyId, id),
    options,
  )
}
