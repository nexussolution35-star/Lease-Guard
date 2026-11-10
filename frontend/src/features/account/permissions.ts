import type { UserRole } from '@leaseguard/domain'

/**
 * Company admins manage the workspace: users and invitations, company settings, WhatsApp and the
 * onboarding checklist. The UI only hides what other roles cannot do; the API enforces every rule.
 */
export function isCompanyAdmin(role: UserRole | null | undefined): boolean {
  return role === 'company_admin'
}
