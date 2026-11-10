import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'

import { httpErrorFromDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toReceivedInvitation, type AcceptedInvitation, type ReceivedInvitation } from './my-invitations.mapper'

/**
 * The database answers every refused accept/decline (not the caller's, not open, unconfirmed email,
 * suspended profile, unknown id) with the same 42501 error. It becomes one 404 so the API reveals
 * nothing about invitations that are not the caller's.
 */
export const NOT_AVAILABLE_OVERRIDES: DatabaseErrorOverrides = {
  '42501': () => new NotFoundException('Invitation not found'),
}

/**
 * The signed-in caller's own invitations (not company-scoped: the invitee is not a member yet). Every
 * call is a database function run through the caller's RLS client; the functions match invitations by
 * the caller's confirmed auth email, and only accepting creates a company membership.
 */
@Injectable()
export class MyInvitationsService {
  /** The caller's open (sent) invitations, newest first. */
  async list(db: DbClient): Promise<ReceivedInvitation[]> {
    const { data, error } = await db.rpc('list_my_company_invitations')
    if (error) throw httpErrorFromDatabase(error, 'List my invitations')
    return (data ?? []).map(toReceivedInvitation)
  }

  /** Joins the invitation's company with the invited role (an existing member keeps their role). */
  async accept(db: DbClient, invitationId: EntityId): Promise<AcceptedInvitation> {
    const { data, error } = await db.rpc('accept_company_invitation', { p_invitation_id: invitationId })
    if (error) throw httpErrorFromDatabase(error, 'Accept invitation', NOT_AVAILABLE_OVERRIDES)
    if (!data) throw new NotFoundException('Invitation not found')
    return { companyId: data }
  }

  async decline(db: DbClient, invitationId: EntityId): Promise<void> {
    const { error } = await db.rpc('decline_company_invitation', { p_invitation_id: invitationId })
    if (error) throw httpErrorFromDatabase(error, 'Decline invitation', NOT_AVAILABLE_OVERRIDES)
  }
}
