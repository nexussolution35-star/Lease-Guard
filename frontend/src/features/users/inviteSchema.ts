import { USER_ROLES, type InvitationStatus } from '@leaseguard/domain'
import { z } from 'zod'

import type { NewInvitation } from './api/source'

/** The "Invite user" form (mirrors `POST /invitations`: email stored lower-case, name up to 200). */
export const inviteFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email address')
    .max(320, 'Use at most 320 characters')
    .pipe(z.email('Enter a valid email address'))
    .transform((value) => value.toLowerCase()),
  fullName: z.string().trim().max(200, 'Use at most 200 characters'),
  role: z.enum(USER_ROLES, { error: 'Choose a role' }),
})

export type InviteFormInput = z.input<typeof inviteFormSchema>
export type InviteFormValues = z.output<typeof inviteFormSchema>

export const INVITE_FORM_DEFAULTS: InviteFormInput = { email: '', fullName: '', role: 'property_manager' }

/** The request body; an empty name is left out. */
export function newInvitationFrom(values: InviteFormValues): NewInvitation {
  return { email: values.email, role: values.role, ...(values.fullName ? { fullName: values.fullName } : {}) }
}

/** Statuses an admin may revoke (the API refuses anything else with 409). */
const REVOCABLE: ReadonlySet<InvitationStatus> = new Set(['pending', 'sent'])
/** Statuses an admin may resend. */
const RESENDABLE: ReadonlySet<InvitationStatus> = new Set(['pending', 'sent', 'failed'])

export function canRevokeInvitation(status: InvitationStatus): boolean {
  return REVOCABLE.has(status)
}

export function canResendInvitation(status: InvitationStatus): boolean {
  return RESENDABLE.has(status)
}
