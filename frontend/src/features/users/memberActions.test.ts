import { describe, expect, it } from 'vitest'

import { memberActions } from './memberActions'

const ME = '7d9f3c2a-0000-5000-8000-000000000001'
const OTHER = '5b0c1d2e-0000-4000-8000-0000000000a2'

describe('memberActions', () => {
  it('lets a company admin change the role of, and remove, another member', () => {
    expect(memberActions({ id: OTHER, role: 'property_manager', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 1 })).toEqual({
      canChangeRole: true,
      canRemove: true,
    })
  })

  it('never lets anyone change their own role or remove themselves', () => {
    expect(memberActions({ id: ME, role: 'company_admin', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 3 })).toEqual({
      canChangeRole: false,
      canRemove: false,
      reason: 'You cannot change your own role or remove yourself. Another company admin must do it.',
    })
  })

  it('compares ids without regard to case', () => {
    expect(memberActions({ id: ME.toUpperCase(), role: 'read_only', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 2 }).canRemove).toBe(false)
  })

  it('protects the last active company admin', () => {
    expect(memberActions({ id: OTHER, role: 'company_admin', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 1 })).toEqual({
      canChangeRole: false,
      canRemove: false,
      reason: 'The company must keep at least one active company admin. Make another member a company admin first.',
    })
  })

  it('allows acting on an admin while another active admin remains', () => {
    expect(memberActions({ id: OTHER, role: 'company_admin', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 2 })).toEqual({
      canChangeRole: true,
      canRemove: true,
    })
  })

  it('does not count an inactive admin as the last admin', () => {
    expect(memberActions({ id: OTHER, role: 'company_admin', status: 'suspended' }, { currentUserId: ME, isAdmin: true, activeAdminCount: 1 }).canRemove).toBe(true)
  })

  it('treats an unknown admin count as safe to try (the API still decides)', () => {
    expect(memberActions({ id: OTHER, role: 'company_admin', status: 'active' }, { currentUserId: ME, isAdmin: true, activeAdminCount: undefined }).canRemove).toBe(true)
  })

  it('offers nothing to members who are not company admins', () => {
    expect(memberActions({ id: OTHER, role: 'read_only', status: 'active' }, { currentUserId: ME, isAdmin: false, activeAdminCount: 1 })).toEqual({
      canChangeRole: false,
      canRemove: false,
    })
  })
})
