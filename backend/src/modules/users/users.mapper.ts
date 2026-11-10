import type { CompanyMembership, User } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type ProfileRow = Tables<'profiles'>
export type CompanyUserRow = Tables<'company_users'>

/** The `company_users` columns that make up a domain `CompanyMembership`. */
export type MembershipRow = Pick<CompanyUserRow, 'company_id' | 'role' | 'is_default' | 'joined_at'>

/** `company_users` row → domain `CompanyMembership`. */
export function toCompanyMembership(row: MembershipRow): CompanyMembership {
  return { companyId: row.company_id, role: row.role, isDefault: row.is_default, joinedAt: row.joined_at }
}

/**
 * `profiles` row plus the memberships the caller may see → domain `User`. Nullable columns become absent
 * optional fields. Pass only memberships that belong in the response (the active company for member
 * lists, every visible company for the caller's own profile).
 */
export function toUser(profile: ProfileRow, memberships: readonly MembershipRow[]): User {
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    ...(profile.phone ? { phone: profile.phone } : {}),
    ...(profile.whatsapp_number ? { whatsappNumber: profile.whatsapp_number } : {}),
    ...(profile.job_title ? { jobTitle: profile.job_title } : {}),
    status: profile.status,
    memberships: memberships.map(toCompanyMembership),
    ...(profile.last_login_at ? { lastLoginAt: profile.last_login_at } : {}),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  }
}
