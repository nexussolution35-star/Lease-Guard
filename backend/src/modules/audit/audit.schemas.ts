import { AUDIT_ACTIONS, compareISODate, ENTITY_TYPES, isValidISODate } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema, SORT_DIRECTIONS } from '../../common/http/pagination'

export const AUDIT_LOG_SORT_FIELDS = ['occurredAt'] as const

const isoDate = z.string().refine(isValidISODate, 'must be a calendar date (YYYY-MM-DD)')

/**
 * Audit log filters. `from` / `to` are South African calendar dates and both are inclusive. Newest
 * entries first unless the caller asks otherwise.
 */
export const auditLogListQuerySchema = listQuerySchema(AUDIT_LOG_SORT_FIELDS, {
  direction: z.enum(SORT_DIRECTIONS).default('desc'),
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorUserId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine((query) => !query.from || !query.to || compareISODate(query.from, query.to) <= 0, {
  path: ['to'],
  message: 'must be on or after from',
})
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>

/** API sort field → database column. */
export const AUDIT_LOG_SORT_COLUMNS = { occurredAt: 'occurred_at' } as const satisfies Record<
  (typeof AUDIT_LOG_SORT_FIELDS)[number],
  string
>
