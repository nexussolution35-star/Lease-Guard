import type { InvitationRow } from './invitations.mapper'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
export const ADMIN = '6f1d2c1e-0000-4000-8000-0000000000a1'
export const INVITATION = '6f1d2c1e-0000-4000-8000-0000000000e1'

export const invitationRow: InvitationRow = {
  id: INVITATION,
  company_id: COMPANY,
  email: 'thandi@example.co.za',
  full_name: 'Thandi Mokoena',
  role: 'property_manager',
  status: 'pending',
  invited_by_user_id: ADMIN,
  invited_user_id: null,
  failure_reason: null,
  sent_at: null,
  accepted_at: null,
  revoked_at: null,
  created_at: '2026-11-09T08:00:00+00:00',
  updated_at: '2026-11-09T08:00:00+00:00',
}
