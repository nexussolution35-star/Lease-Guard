import type { CompanyMembership, User } from '@leaseguard/domain'

import { toCompanySummary, type CompanySummary, type CompanySummaryRow } from '../companies/companies.mapper'
import { toCompanyMembership, toUser, type MembershipRow, type ProfileRow } from '../users/users.mapper'

/** A membership of the caller with the company it grants access to, for the workspace switcher. */
export interface MembershipWithCompany extends CompanyMembership {
  company: CompanySummary
}

/** The signed-in caller: their profile (domain `User`) with each membership's company summary. */
export interface CurrentUserProfile extends User {
  memberships: readonly MembershipWithCompany[]
}

export type MembershipWithCompanyRow = MembershipRow & { company: CompanySummaryRow }

export function toMembershipWithCompany(row: MembershipWithCompanyRow): MembershipWithCompany {
  return { ...toCompanyMembership(row), company: toCompanySummary(row.company) }
}

/** Profile row plus the caller's visible memberships (each with its company) → `CurrentUserProfile`. */
export function toCurrentUserProfile(
  profile: ProfileRow,
  memberships: readonly MembershipWithCompanyRow[],
): CurrentUserProfile {
  return { ...toUser(profile, []), memberships: memberships.map(toMembershipWithCompany) }
}
