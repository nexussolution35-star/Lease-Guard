import { NOTIFICATION_SEVERITIES, NOTIFICATION_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema, SORT_DIRECTIONS } from '../../common/http/pagination'

export const NOTIFICATION_SORT_FIELDS = ['createdAt'] as const

/** The caller's notifications: newest first unless the caller asks otherwise. */
export const notificationListQuerySchema = listQuerySchema(NOTIFICATION_SORT_FIELDS, {
  direction: z.enum(SORT_DIRECTIONS).default('desc'),
  /** `true` lists only unread notifications. */
  unreadOnly: z.stringbool().optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
})
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>

/** API sort field → database column. */
export const NOTIFICATION_SORT_COLUMNS = { createdAt: 'created_at' } as const satisfies Record<
  (typeof NOTIFICATION_SORT_FIELDS)[number],
  string
>
