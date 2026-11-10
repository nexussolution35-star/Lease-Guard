import type { UserRole } from '@leaseguard/domain'

/**
 * Company admins manage the workspace: users and invitations, company settings, WhatsApp and the
 * onboarding checklist. The UI only hides what other roles cannot do; the API enforces every rule.
 */
export function isCompanyAdmin(role: UserRole | null | undefined): boolean {
  return role === 'company_admin'
}

/**
 * Company writers (company admins and property managers) change company data: e.g. they take WhatsApp conversations
 * over and reply to contacts. Read-only members and property owners only read. Mirrors the API's WRITER_ROLES.
 */
export function isCompanyWriter(role: UserRole | null | undefined): boolean {
  return role === 'company_admin' || role === 'property_manager'
}
