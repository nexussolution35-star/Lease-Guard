import type { UserRole } from '@leaseguard/domain'

import { canReadAuditLog, isCompanyAdmin, isCompanyWriter } from '@/features/account/permissions'

export interface RoleCapability {
  id: string
  /** The area of the product, e.g. "Workspace". */
  area: string
  label: string
  allows: (role: UserRole) => boolean
}

const everyMember = () => true

/**
 * What each role may do, as Settings → Roles shows it. Each row uses the same role check the screens
 * use to hide actions, and each of those mirrors a rule the API enforces. Roles are fixed in the MVP.
 */
export const ROLE_CAPABILITIES: readonly RoleCapability[] = [
  { id: 'view-records', area: 'Portfolio', label: 'View properties, units, tenants, leases, statements, monitoring events, payment arrangements and reports', allows: everyMember },
  { id: 'view-members', area: 'Workspace', label: 'See who has access to the workspace and the company settings', allows: everyMember },
  { id: 'verify-leases', area: 'Leases', label: 'Verify lease terms so they can be used for financial monitoring', allows: isCompanyWriter },
  { id: 'statements', area: 'Statements', label: 'Upload statements and start their processing', allows: isCompanyWriter },
  { id: 'monitoring', area: 'Monitoring', label: 'Update monitoring events: review, resolve or dismiss with a reason', allows: isCompanyWriter },
  { id: 'approve-messages', area: 'Communication', label: 'Approve or reject tenant messages before they are sent', allows: isCompanyWriter },
  { id: 'conversations', area: 'Communication', label: 'Take over WhatsApp conversations and reply to contacts', allows: isCompanyWriter },
  { id: 'audit-log', area: 'Workspace', label: 'View the audit log', allows: canReadAuditLog },
  { id: 'company-settings', area: 'Workspace', label: 'Change company details, notice periods and reminder timing', allows: isCompanyAdmin },
  { id: 'users', area: 'Workspace', label: 'Invite people, change roles and remove members', allows: isCompanyAdmin },
  { id: 'whatsapp', area: 'Workspace', label: 'Connect WhatsApp Business numbers and configure the AI agent and its knowledge', allows: isCompanyAdmin },
]

/** The capabilities a role has, in matrix order. */
export function capabilitiesOf(role: UserRole): RoleCapability[] {
  return ROLE_CAPABILITIES.filter((capability) => capability.allows(role))
}

