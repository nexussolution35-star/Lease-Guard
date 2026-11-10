import { INVITATION_STATUSES, type CompanyInvitation, type InvitationStatus } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type InvitationRow = Tables<'company_invitations'>

function toInvitationStatus(status: string): InvitationStatus {
  const known = INVITATION_STATUSES.find((value) => value === status)
  // The CHECK constraint allows exactly these values; anything else means the schema changed.
  if (!known) throw new Error(`Unknown invitation status "${status}"`)
  return known
}

/** `company_invitations` row → domain `CompanyInvitation`. Nullable columns become absent optional fields. */
export function toInvitation(row: InvitationRow): CompanyInvitation {
  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
    ...(row.full_name ? { fullName: row.full_name } : {}),
    role: row.role,
    status: toInvitationStatus(row.status),
    ...(row.invited_by_user_id ? { invitedByUserId: row.invited_by_user_id } : {}),
    ...(row.invited_user_id ? { invitedUserId: row.invited_user_id } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    ...(row.sent_at ? { sentAt: row.sent_at } : {}),
    ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
