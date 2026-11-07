import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import { generateId, nowISO } from '@/store/ids'
import type { CompanyMembership, EntityId, RolePermissions, User, UserRole } from '@leaseguard/domain'

import { getActiveCompanyId, getCurrentUserId, recordAudit } from '@/services/repository'

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, RolePermissions>> = {
  company_admin: {
    manageCompany: true,
    manageUsers: true,
    manageProperties: true,
    manageLeases: true,
    verifyLeases: true,
    uploadStatements: true,
    reviewStatements: true,
    manageMonitoringEvents: true,
    manageArrangements: true,
    approveMessages: true,
    viewAuditLogs: true,
  },
  property_manager: {
    manageCompany: false,
    manageUsers: false,
    manageProperties: true,
    manageLeases: true,
    verifyLeases: true,
    uploadStatements: true,
    reviewStatements: true,
    manageMonitoringEvents: true,
    manageArrangements: true,
    approveMessages: true,
    viewAuditLogs: true,
  },
  property_owner: {
    manageCompany: false,
    manageUsers: false,
    manageProperties: false,
    manageLeases: false,
    verifyLeases: false,
    uploadStatements: false,
    reviewStatements: false,
    manageMonitoringEvents: false,
    manageArrangements: false,
    approveMessages: false,
    viewAuditLogs: false,
  },
  read_only: {
    manageCompany: false,
    manageUsers: false,
    manageProperties: false,
    manageLeases: false,
    verifyLeases: false,
    uploadStatements: false,
    reviewStatements: false,
    manageMonitoringEvents: false,
    manageArrangements: false,
    approveMessages: false,
    viewAuditLogs: true,
  },
}

export function getPermissions(role: UserRole | undefined): RolePermissions {
  return role ? ROLE_PERMISSIONS[role] : ROLE_PERMISSIONS.read_only
}

export function getUserById(id: EntityId): User | undefined {
  return useAppStore.getState().collections.users[id]
}

export function getCurrentUser(): User {
  const user = getUserById(getCurrentUserId())
  if (!user) throw new Error('Current user not found')
  return user
}

export function membershipFor(user: User, companyId: EntityId): CompanyMembership | undefined {
  return user.memberships.find((m) => m.companyId === companyId)
}

/** The current user's membership in the active workspace. */
export function getCurrentMembership(): CompanyMembership | undefined {
  return membershipFor(getCurrentUser(), getActiveCompanyId())
}

export function getCurrentRole(): UserRole | undefined {
  return getCurrentMembership()?.role
}

function usersOf(users: Readonly<Record<EntityId, User>>, companyId: EntityId): User[] {
  return Object.values(users).filter((u) => membershipFor(u, companyId) !== undefined)
}

/** Users with a membership in the active company. */
export function listCompanyUsers(): User[] {
  const { collections, workspace } = useAppStore.getState()
  return usersOf(collections.users, workspace.activeCompanyId)
}

export interface InviteUserInput {
  fullName: string
  email: string
  role: UserRole
  phone?: string
  whatsappNumber?: string
  jobTitle?: string
}

/** Create an invited user with a membership in the active company. */
export function inviteUser(input: InviteUserInput): User {
  const companyId = getActiveCompanyId()
  const at = nowISO()
  const user: User = {
    id: generateId('usr'),
    createdAt: at,
    updatedAt: at,
    fullName: input.fullName,
    email: input.email,
    status: 'invited',
    memberships: [{ companyId, role: input.role, isDefault: true, joinedAt: at }],
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.whatsappNumber ? { whatsappNumber: input.whatsappNumber } : {}),
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
  }
  useAppStore.getState().upsert('users', user)
  recordAudit({
    action: 'create',
    entityType: 'user',
    entityId: user.id,
    summary: `Invited ${user.fullName} as ${input.role}`,
  })
  return user
}

/** Change (or add) the user's role in the active company. */
export function setRole(userId: EntityId, role: UserRole): User {
  const companyId = getActiveCompanyId()
  const before = getUserById(userId)
  if (!before) throw new Error(`User ${userId} not found`)
  const existing = membershipFor(before, companyId)
  const memberships: CompanyMembership[] = existing
    ? before.memberships.map((m) => (m.companyId === companyId ? { ...m, role } : m))
    : [...before.memberships, { companyId, role, isDefault: before.memberships.length === 0, joinedAt: nowISO() }]
  const after: User = { ...before, memberships, updatedAt: nowISO() }
  useAppStore.getState().upsert('users', after)
  recordAudit({
    action: 'update',
    entityType: 'user',
    entityId: userId,
    summary: `Role for ${after.fullName} set to ${role}`,
    changes: [{ field: 'role', before: existing?.role ?? null, after: role }],
  })
  return after
}

export function setUserStatus(userId: EntityId, status: User['status']): User {
  const before = getUserById(userId)
  if (!before) throw new Error(`User ${userId} not found`)
  const after: User = { ...before, status, updatedAt: nowISO() }
  useAppStore.getState().upsert('users', after)
  recordAudit({
    action: 'update',
    entityType: 'user',
    entityId: userId,
    summary: `User ${after.fullName} marked ${status}`,
    changes: [{ field: 'status', before: before.status, after: status }],
  })
  return after
}

// Hooks --------------------------------------------------------------------

export function useCurrentUser(): User | undefined {
  return useAppStore((s) => s.collections.users[s.workspace.currentUserId])
}

export function useCompanyUsers(): User[] {
  const users = useAppStore((s) => s.collections.users)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  return useMemo(() => usersOf(users, companyId), [users, companyId])
}

export function useCurrentRole(): UserRole | undefined {
  const user = useCurrentUser()
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  return user ? membershipFor(user, companyId)?.role : undefined
}

/** Permissions for an explicit role, or for the current user's role in the active workspace. */
export function usePermissions(role?: UserRole): RolePermissions {
  const currentRole = useCurrentRole()
  return getPermissions(role ?? currentRole)
}
