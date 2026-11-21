import type { MonitoringEventSortField } from '@leaseguard/api-client'
import type {
  EntityId,
  EventPriority,
  MonitoringDueWindow,
  MonitoringEventListItem,
  MonitoringEventStatus,
  MonitoringEventType,
  UNASSIGNED_FILTER,
} from '@leaseguard/domain'
import type { UpdateMonitoringEventStatusDto } from '@leaseguard/api-client'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { MonitoringEventSortField }

/** Sort fields accepted by `GET /api/v1/monitoring/events` (generated from the backend's OpenAPI document). */
export const MONITORING_EVENT_SORT_FIELDS = ['identifiedOn', 'dueDate', 'priority', 'createdAt'] as const satisfies readonly MonitoringEventSortField[]

/** Filters accepted by `GET /api/v1/monitoring/events`, each a single optional value. */
export interface MonitoringEventListParams extends ListParams<MonitoringEventSortField> {
  status?: MonitoringEventStatus
  /** true: still needs attention (new, under review, action required, in progress); false: resolved or dismissed. */
  open?: boolean
  priority?: EventPriority
  type?: MonitoringEventType
  propertyId?: EntityId
  unitId?: EntityId
  tenantId?: EntityId
  leaseId?: EntityId
  /** One member's user id, or `unassigned` for events nobody is assigned to. */
  assignee?: EntityId | typeof UNASSIGNED_FILTER
  /** Due-date window on the South African date (domain `dueWindowRange`, applied by the API). */
  due?: MonitoringDueWindow
}

/**
 * Where monitoring events come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface MonitoringEventSource {
  /** Each listed event names its property and, when set, its unit, tenant and assignee. */
  list(companyId: EntityId, params: MonitoringEventListParams): Promise<Page<MonitoringEventListItem>>
  /** The event with the names of its property and, when set, its unit, tenant and assignee. */
  get(companyId: EntityId, id: EntityId): Promise<MonitoringEventListItem | null>
  /**
   * Moves the event to another status (writers; the API applies the domain workflow and answers 409 when the move is
   * not allowed or the event changed meanwhile). The note is the dismissal reason, or the resolution notes otherwise.
   */
  updateStatus(companyId: EntityId, id: EntityId, change: MonitoringEventStatusChange): Promise<MonitoringEventListItem>
}

/** Body of `PATCH /api/v1/monitoring/events/{eventId}/status`. */
export type MonitoringEventStatusChange = UpdateMonitoringEventStatusDto
