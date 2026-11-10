import type { EntityId, ISODateTime, UserRole } from '@leaseguard/domain'

import type { Database } from '../../infrastructure/database/database.types'

export type ReceivedInvitationRow = Database['public']['Functions']['list_my_company_invitations']['Returns'][number]

/**
 * An open invitation addressed to the signed-in caller (matched by their confirmed email). The caller is
 * not a member of the company yet, so this carries the company name they need to decide.
 */
export interface ReceivedInvitation {
  id: EntityId
  companyId: EntityId
  companyName: string
  role: UserRole
  /** Absent for invitations created by Nexus platform tooling. */
  invitedByName?: string
  createdAt: ISODateTime
}

/** The caller's newly joined company after accepting an invitation. */
export interface AcceptedInvitation {
  companyId: EntityId
}

/** `list_my_company_invitations()` row → `ReceivedInvitation`. */
export function toReceivedInvitation(row: ReceivedInvitationRow): ReceivedInvitation {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    role: row.role,
    ...(row.invited_by_name ? { invitedByName: row.invited_by_name } : {}),
    createdAt: row.created_at,
  }
}
