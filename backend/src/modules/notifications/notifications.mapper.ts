import type { Notification } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type NotificationRow = Tables<'notifications'>

/** Result of marking every unread notification as read. */
export interface MarkAllReadResult {
  /** Number of notifications that changed from unread to read. */
  updated: number
}

/** Database row → domain `Notification`. Nullable columns become absent optional fields. */
export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    read: row.read,
    ...(row.read_at ? { readAt: row.read_at } : {}),
    ...(row.link_entity_type && row.link_entity_id
      ? { link: { entityType: row.link_entity_type, entityId: row.link_entity_id } }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
