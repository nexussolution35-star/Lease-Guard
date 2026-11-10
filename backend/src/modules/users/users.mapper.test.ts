import { describe, expect, it } from 'vitest'

import { toCompanyMembership, toUser } from './users.mapper'
import { membershipRow, profileRow } from './users.test-helpers'

describe('users mapper', () => {
  it('maps a membership row to the domain CompanyMembership', () => {
    expect(toCompanyMembership(membershipRow)).toEqual({
      companyId: membershipRow.company_id,
      role: 'property_manager',
      isDefault: true,
      joinedAt: membershipRow.joined_at,
    })
  })

  it('maps a profile to the domain User, dropping null optional fields', () => {
    const user = toUser(profileRow, [membershipRow])

    expect(user).toEqual({
      id: profileRow.id,
      fullName: 'Sipho Dlamini',
      email: 'sipho.dlamini@nexussolution.co.za',
      whatsappNumber: '+27821234567',
      jobTitle: 'Property Manager',
      status: 'active',
      memberships: [toCompanyMembership(membershipRow)],
      createdAt: profileRow.created_at,
      updatedAt: profileRow.updated_at,
    })
    expect(user).not.toHaveProperty('phone')
    expect(user).not.toHaveProperty('lastLoginAt')
  })

  it('keeps phone and last sign-in when present', () => {
    const user = toUser({ ...profileRow, phone: '+27115550100', last_login_at: '2026-11-08T07:00:00+00:00' }, [])
    expect(user).toMatchObject({ phone: '+27115550100', lastLoginAt: '2026-11-08T07:00:00+00:00', memberships: [] })
  })
})
