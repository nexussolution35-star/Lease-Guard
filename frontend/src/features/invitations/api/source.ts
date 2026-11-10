import type { AcceptedInvitationDto, ReceivedInvitationDto } from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

/** An open invitation addressed to the signed-in user (matched by their confirmed sign-in email). */
export type ReceivedInvitation = ReceivedInvitationDto

/** The company the user joined by accepting. */
export type AcceptedInvitation = AcceptedInvitationDto

/**
 * The signed-in user's own invitations (`/api/v1/me/invitations`, not company-scoped: the invitee is
 * not a member yet). Accepting is the only way a company membership is created.
 */
export interface MyInvitationSource {
  /** Open (sent) invitations, newest first. */
  list(): Promise<ReceivedInvitation[]>
  /** Joins the company with the invited role. Rejects with a 404 ApiError when the invitation is not available. */
  accept(invitationId: EntityId): Promise<AcceptedInvitation>
  /** Rejects with a 404 ApiError when the invitation is not available. */
  decline(invitationId: EntityId): Promise<void>
}
