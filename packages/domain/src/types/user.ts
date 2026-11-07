import type { BaseEntity, EntityId, ISODateTime } from './common.js'

/**
 * Roles are per company membership (the `company_users` concept). A user may belong to several
 * companies with different roles.
 */
export const USER_ROLES = ['company_admin', 'property_manager', 'property_owner', 'read_only'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ['active', 'invited', 'suspended', 'deactivated'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export interface CompanyMembership {
  companyId: EntityId
  role: UserRole
  /** Workspace opened by default on login. */
  isDefault: boolean
  joinedAt: ISODateTime
}

export interface User extends BaseEntity {
  fullName: string
  email: string
  phone?: string
  /** Required for property owners who receive WhatsApp summaries. */
  whatsappNumber?: string
  jobTitle?: string
  status: UserStatus
  memberships: readonly CompanyMembership[]
  lastLoginAt?: ISODateTime
}

/** Capability flags derived from role; used by UI guards (demo only, not security). */
export interface RolePermissions {
  manageCompany: boolean
  manageUsers: boolean
  manageProperties: boolean
  manageLeases: boolean
  verifyLeases: boolean
  uploadStatements: boolean
  reviewStatements: boolean
  manageMonitoringEvents: boolean
  manageArrangements: boolean
  approveMessages: boolean
  viewAuditLogs: boolean
}
