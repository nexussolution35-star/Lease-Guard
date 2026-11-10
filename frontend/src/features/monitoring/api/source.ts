import type { MonitoringEventSortField } from '@leaseguard/api-client'
import type { EntityId, EventPriority, MonitoringEvent, MonitoringEventStatus, MonitoringEventType } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { MonitoringEventSortField }

/** Sort fields accepted by `GET /api/v1/monitoring/events` (generated from the backend's OpenAPI document). */
export const MONITORING_EVENT_SORT_FIELDS = ['identifiedOn', 'dueDate', 'priority', 'createdAt'] as const satisfies readonly MonitoringEventSortField[]

/** Filters accepted by `GET /api/v1/monitoring/events`, each a single optional value. */
export interface MonitoringEventListParams extends ListParams<MonitoringEventSortField> {
  status?: MonitoringEventStatus
  priority?: EventPriority
  type?: MonitoringEventType
  propertyId?: EntityId
  leaseId?: EntityId
}

/**
 * Where monitoring events come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface MonitoringEventSource {
  list(companyId: EntityId, params: MonitoringEventListParams): Promise<Page<MonitoringEvent>>
  get(companyId: EntityId, id: EntityId): Promise<MonitoringEvent | null>
}
