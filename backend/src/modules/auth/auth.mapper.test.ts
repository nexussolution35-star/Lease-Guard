import { describe, expect, it } from 'vitest'

import { companyRow } from '../companies/companies.test-helpers'
import { membershipRow, profileRow } from '../users/users.test-helpers'
import { toCurrentUserProfile } from './auth.mapper'

const companySummaryRow = {
  id: companyRow.id,
  name: companyRow.name,
  trading_name: companyRow.trading_name,
  initials: companyRow.initials,
  status: companyRow.status,
}

describe('auth mapper', () => {
  it('maps the caller profile with each membership and its company summary', () => {
    const second = {
      company_id: '6f1d2c1e-0000-4000-8000-000000000002',
      role: 'read_only' as const,
      is_default: false,
      joined_at: '2026-06-01T08:00:00+00:00',
      company: { id: '6f1d2c1e-0000-4000-8000-000000000002', name: 'Kgalagadi', trading_name: null, initials: 'KP', status: 'active' as const },
    }

    const me = toCurrentUserProfile(profileRow, [{ ...membershipRow, company: companySummaryRow }, second])

    expect(me).toMatchObject({ id: profileRow.id, fullName: 'Sipho Dlamini', email: profileRow.email, status: 'active' })
    expect(me.memberships).toEqual([
      {
        companyId: companyRow.id,
        role: 'property_manager',
        isDefault: true,
        joinedAt: membershipRow.joined_at,
        company: { id: companyRow.id, name: companyRow.name, tradingName: 'Nexus Solution', initials: 'NS', status: 'active' },
      },
      {
        companyId: second.company_id,
        role: 'read_only',
        isDefault: false,
        joinedAt: second.joined_at,
        company: { id: second.company.id, name: 'Kgalagadi', initials: 'KP', status: 'active' },
      },
    ])
  })

  it('returns a profile without memberships for a user who has none visible', () => {
    expect(toCurrentUserProfile({ ...profileRow, status: 'suspended' }, [])).toMatchObject({
      status: 'suspended',
      memberships: [],
    })
  })
})
