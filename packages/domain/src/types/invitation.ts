import type { CompanyScoped, EntityId, ISODateTime } from './common.js'
import type { UserRole } from './user.js'

/**
 * Lifecycle of an invitation to join a company (invite-only onboarding; public sign-up is off).
 *   pending  → created by a company_admin, waiting for the worker to send it
 *   sent     → the invitation email went out through Supabase Auth
 *   accepted → the invitee accepted it while signed in with the invited email (membership created)
 *   revoked  → withdrawn by a company_admin before it was accepted
 *   declined → the invitee declined it
 *   failed   → sending failed permanently (see `failureReason`)
 */
export const INVITATION_STATUSES = ['pending', 'sent', 'accepted', 'revoked', 'declined', 'failed'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

/** An invitation for one email address to join a company with a role. */
export interface CompanyInvitation extends CompanyScoped {
  /** Lower-case and trimmed. */
  email: string
  /** Shown in the invitation email. */
  fullName?: string
  role: UserRole
  status: InvitationStatus
  /** The company_admin who invited; absent for invitations created by Nexus platform tooling. */
  invitedByUserId?: EntityId
  /** The invitee's user id, once their account exists. */
  invitedUserId?: EntityId
  /** Why sending failed, for status `failed`. */
  failureReason?: string
  sentAt?: ISODateTime
  acceptedAt?: ISODateTime
  revokedAt?: ISODateTime
}
