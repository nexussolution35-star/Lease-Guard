import { CHANNELS, DELIVERY_STATUSES, MESSAGE_TYPES, RECIPIENT_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema, pageQuerySchema, SORT_DIRECTIONS } from '../../common/http/pagination'

export const COMMUNICATION_SORT_FIELDS = ['createdAt', 'sentAt', 'status'] as const

/** Communications list: newest first unless the caller asks otherwise. */
export const communicationListQuerySchema = listQuerySchema(COMMUNICATION_SORT_FIELDS, {
  direction: z.enum(SORT_DIRECTIONS).default('desc'),
  status: z.enum(DELIVERY_STATUSES).optional(),
  messageType: z.enum(MESSAGE_TYPES).optional(),
  recipientType: z.enum(RECIPIENT_TYPES).optional(),
  channel: z.enum(CHANNELS).optional(),
  tenantId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
})
export type CommunicationListQuery = z.infer<typeof communicationListQuerySchema>

/** API sort field → database column. */
export const COMMUNICATION_SORT_COLUMNS = {
  createdAt: 'created_at',
  sentAt: 'sent_at',
  status: 'status',
} as const satisfies Record<(typeof COMMUNICATION_SORT_FIELDS)[number], string>

export const APPROVAL_QUEUE_SORT_FIELDS = ['requestedAt'] as const

/**
 * Pending approval queue: oldest request first by default, so the longest-waiting message is reviewed
 * first. No free-text search: the queue is short and filtered by decision.
 */
export const approvalQueueQuerySchema = pageQuerySchema.omit({ search: true }).extend({
  sort: z.enum(APPROVAL_QUEUE_SORT_FIELDS).optional(),
})
export type ApprovalQueueQuery = z.infer<typeof approvalQueueQuerySchema>

export const APPROVAL_QUEUE_SORT_COLUMNS = { requestedAt: 'requested_at' } as const satisfies Record<
  (typeof APPROVAL_QUEUE_SORT_FIELDS)[number],
  string
>

const NOTE_MAX_LENGTH = 1000

/** Optional note recorded with an approval (stored as the approval's reason). */
export const approveCommunicationBodySchema = z.object({
  note: z
    .string()
    .trim()
    .max(NOTE_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
})
export type ApproveCommunicationBody = z.infer<typeof approveCommunicationBodySchema>

/** A rejection must say why: the reason is shown to the requester and kept in the audit trail. */
export const rejectCommunicationBodySchema = z.object({
  note: z.string().trim().min(1, 'A reason is required to reject a message').max(NOTE_MAX_LENGTH),
})
export type RejectCommunicationBody = z.infer<typeof rejectCommunicationBodySchema>
