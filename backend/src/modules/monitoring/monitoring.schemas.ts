import {
  EVENT_PRIORITIES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type MonitoringEventStatus,
} from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const MONITORING_EVENT_SORT_FIELDS = ['identifiedOn', 'dueDate', 'priority', 'createdAt'] as const

export const monitoringEventListQuerySchema = listQuerySchema(MONITORING_EVENT_SORT_FIELDS, {
  status: z.enum(MONITORING_EVENT_STATUSES).optional(),
  priority: z.enum(EVENT_PRIORITIES).optional(),
  type: z.enum(MONITORING_EVENT_TYPES).optional(),
  propertyId: z.uuid().optional(),
  leaseId: z.uuid().optional(),
})
export type MonitoringEventListQuery = z.infer<typeof monitoringEventListQuerySchema>

/** API sort field → database column. `priority` sorts by enum order (low → critical). */
export const MONITORING_EVENT_SORT_COLUMNS = {
  identifiedOn: 'identified_on',
  dueDate: 'due_date',
  priority: 'priority',
  createdAt: 'created_at',
} as const satisfies Record<(typeof MONITORING_EVENT_SORT_FIELDS)[number], string>

/** Statuses a person can move an event to; `new` is only ever set when an event is raised. */
export const MONITORING_EVENT_TARGET_STATUSES = [
  'under_review',
  'action_required',
  'in_progress',
  'resolved',
  'dismissed',
] as const satisfies readonly MonitoringEventStatus[]

/**
 * Body of a status change. The note becomes the dismissal reason (required: the database requires
 * every dismissal to record why) or, for any other status, the resolution notes.
 */
export const updateMonitoringEventStatusBodySchema = z
  .strictObject({
    status: z.enum(MONITORING_EVENT_TARGET_STATUSES),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((body) => body.status !== 'dismissed' || body.note !== undefined, {
    path: ['note'],
    message: 'is required to dismiss an event',
  })
export type UpdateMonitoringEventStatusBody = z.infer<typeof updateMonitoringEventStatusBodySchema>

/** Shape of `monitoring_events.calculation` (the domain `EventCalculation`). */
export const eventCalculationSchema = z.object({
  expectedAmount: z.number().optional(),
  actualAmount: z.number().optional(),
  difference: z.number().optional(),
  steps: z.array(z.string()),
})
