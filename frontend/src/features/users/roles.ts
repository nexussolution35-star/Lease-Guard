import { USER_ROLES, type UserRole } from '@leaseguard/domain'

import { labelFor } from '@/lib/labels'

/** What each role may do in a workspace, in the words shown when choosing a role. The API enforces every rule. */
export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  company_admin: 'Manages the workspace: users and invitations, company settings and WhatsApp. Can also do everything a property manager does.',
  property_manager: 'Manages properties, tenants, leases, statements and arrangements, and approves tenant messages.',
  property_owner: 'Views the workspace’s records and reports. Cannot change data or approve messages.',
  read_only: 'Views the workspace’s records. Cannot change data or approve messages.',
}

/** Role options for a select, each with its label. */
export const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: labelFor(role) }))
