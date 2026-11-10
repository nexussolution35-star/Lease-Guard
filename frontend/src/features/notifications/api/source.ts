import type { NotificationSortField } from '@leaseguard/api-client'
import type { EntityId, Notification, NotificationSeverity, NotificationType } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { NotificationSortField }

/** Filters accepted by `GET /api/v1/notifications`, each a single optional value. */
export interface NotificationListParams extends ListParams<NotificationSortField> {
  unreadOnly?: boolean
  type?: NotificationType
  severity?: NotificationSeverity
}

/**
 * The signed-in user's in-app notifications in one company.
 */
export interface NotificationSource {
  list(companyId: EntityId, params: NotificationListParams): Promise<Page<Notification>>
  /** The updated notification, or null when it does not exist for this user in that company (404). */
  markRead(companyId: EntityId, id: EntityId): Promise<Notification | null>
  /** Number of notifications that changed from unread to read. */
  markAllRead(companyId: EntityId): Promise<number>
}
