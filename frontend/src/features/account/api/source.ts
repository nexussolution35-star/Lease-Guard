import type { CurrentUserProfileDto, MembershipWithCompanyDto, UpdateMeDto } from '@leaseguard/api-client'

/**
 * The signed-in user's profile and company memberships from `GET /api/v1/me`. Each membership carries
 * a company summary so the workspace switcher needs no further request.
 */
export type CurrentUserProfile = CurrentUserProfileDto

/** One company the signed-in user belongs to, with their role there. */
export type WorkspaceMembership = MembershipWithCompanyDto

/** Changes to the user's own profile (`PATCH /api/v1/me`); null clears an optional field. */
export type ProfileChanges = UpdateMeDto

export interface AccountSource {
  /** Null when the signed-in user has no LeaseGuard profile (API 404). */
  getCurrentUser(): Promise<CurrentUserProfile | null>
  /** Updates the signed-in user's own profile and returns it as `getCurrentUser` would. */
  updateCurrentUser(changes: ProfileChanges): Promise<CurrentUserProfile>
}
