import type { EntityId, UserRole } from '@leaseguard/domain'

import { isCompanyWriter } from '@/features/account/permissions'
import type { CompanyMember } from '@/features/users/api/source'

/** Members who can take over a WhatsApp conversation of `companyId`: active company admins and property managers. */
export function assignableMembers(members: readonly CompanyMember[], companyId: EntityId): CompanyMember[] {
  return members.filter(
    (member) => member.status === 'active' && member.memberships.some((m) => m.companyId === companyId && isCompanyWriter(m.role as UserRole)),
  )
}
