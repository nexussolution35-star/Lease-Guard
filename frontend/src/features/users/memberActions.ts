import type { EntityId, UserRole, UserStatus } from '@leaseguard/domain'

export interface MemberActionTarget {
  id: EntityId
  role: UserRole
  status: UserStatus
}

export interface MemberActionContext {
  /** The signed-in user; null until `/me` has loaded. */
  currentUserId: string | null
  /** The signed-in user is a company admin of the active workspace. */
  isAdmin: boolean
  /** Active company admins of the workspace; undefined while unknown (the API still refuses with 409). */
  activeAdminCount: number | undefined
}

export interface MemberActionAvailability {
  canChangeRole: boolean
  canRemove: boolean
  /** Why a company admin cannot act on this member; absent when they can (or when the viewer is not an admin). */
  reason?: string
}

export const SELF_ACTION_REASON = 'You cannot change your own role or remove yourself. Another company admin must do it.'
export const LAST_ADMIN_REASON = 'The company must keep at least one active company admin. Make another member a company admin first.'

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * What the viewer may do to a member in Settings → Users. Mirrors the API and database rules so the screen can
 * explain them before anyone tries: only company admins manage members, nobody changes their own role or removes
 * themselves, and the company always keeps an active company admin. The API enforces every rule regardless.
 */
export function memberActions(member: MemberActionTarget, context: MemberActionContext): MemberActionAvailability {
  if (!context.isAdmin || context.currentUserId === null) return { canChangeRole: false, canRemove: false }
  if (sameId(member.id, context.currentUserId)) {
    return { canChangeRole: false, canRemove: false, reason: SELF_ACTION_REASON }
  }
  const isLastActiveAdmin =
    member.role === 'company_admin' && member.status === 'active' && context.activeAdminCount !== undefined && context.activeAdminCount <= 1
  if (isLastActiveAdmin) return { canChangeRole: false, canRemove: false, reason: LAST_ADMIN_REASON }
  return { canChangeRole: true, canRemove: true }
}
