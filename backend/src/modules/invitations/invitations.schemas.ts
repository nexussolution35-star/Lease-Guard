import { INVITATION_STATUSES, USER_ROLES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const INVITATION_SORT_FIELDS = ['createdAt', 'email', 'status'] as const

export const invitationListQuerySchema = listQuerySchema(INVITATION_SORT_FIELDS, {
  status: z.enum(INVITATION_STATUSES).optional(),
})
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>

/** API sort field → database column. */
export const INVITATION_SORT_COLUMNS = { createdAt: 'created_at', email: 'email', status: 'status' } as const satisfies Record<
  (typeof INVITATION_SORT_FIELDS)[number],
  string
>

/** Body of POST /invitations. The email is stored lower-case and trimmed (as the database does). */
export const createInvitationBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().max(320).pipe(z.email('must be an email address')),
    role: z.enum(USER_ROLES),
    fullName: z
      .string()
      .trim()
      .max(200)
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .strict()
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>

/**
 * Invitation statuses an admin may resend: pending (recovers an invitation whose send job was never
 * queued), sent but not answered yet, or failed to send.
 */
export const RESENDABLE_INVITATION_STATUSES = ['pending', 'sent', 'failed'] as const

/** Invitation statuses an admin may revoke (the database allows nothing else). */
export const REVOCABLE_INVITATION_STATUSES = ['pending', 'sent'] as const
