import type { MembershipRow, ProfileRow } from './users.mapper'

/** Test fixtures shared by the users and auth tests. */
export const profileRow: ProfileRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000b1',
  full_name: 'Sipho Dlamini',
  email: 'sipho.dlamini@nexussolution.co.za',
  phone: null,
  whatsapp_number: '+27821234567',
  job_title: 'Property Manager',
  status: 'active',
  last_login_at: null,
  created_at: '2026-11-01T08:00:00+00:00',
  updated_at: '2026-11-02T08:00:00+00:00',
}

export const membershipRow: MembershipRow = {
  company_id: '6f1d2c1e-0000-4000-8000-000000000001',
  role: 'property_manager',
  is_default: true,
  joined_at: '2026-01-15T08:00:00+00:00',
}
