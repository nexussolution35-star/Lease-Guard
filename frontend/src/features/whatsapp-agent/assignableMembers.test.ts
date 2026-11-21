import { describe, expect, it } from 'vitest'

import type { CompanyMember } from '@/features/users/api/source'

import { assignableMembers } from './assignableMembers'

const member = (id: string, role: string, status = 'active', companyId = 'c1') =>
  ({ id, fullName: id, email: `${id}@example.co.za`, status, memberships: [{ companyId, role }] }) as unknown as CompanyMember

describe('assignableMembers', () => {
  it('offers only active company admins and property managers of the company', () => {
    const members = [member('admin', 'company_admin'), member('pm', 'property_manager'), member('reader', 'read_only'), member('owner', 'property_owner'), member('gone', 'property_manager', 'deactivated'), member('other', 'property_manager', 'active', 'c2')]
    expect(assignableMembers(members, 'c1').map((m) => m.id)).toEqual(['admin', 'pm'])
  })
})
