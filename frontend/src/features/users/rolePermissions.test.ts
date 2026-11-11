import { USER_ROLES } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { canReadAuditLog, isCompanyAdmin, isCompanyWriter } from '@/features/account/permissions'

import { capabilitiesOf, ROLE_CAPABILITIES } from './rolePermissions'

const ids = (role: (typeof USER_ROLES)[number]) => capabilitiesOf(role).map((capability) => capability.id)

describe('ROLE_CAPABILITIES', () => {
  it('gives a company admin everything', () => {
    expect(capabilitiesOf('company_admin')).toHaveLength(ROLE_CAPABILITIES.length)
  })

  it('gives a property manager everything except workspace administration', () => {
    expect(ROLE_CAPABILITIES.map((c) => c.id).filter((id) => !ids('property_manager').includes(id))).toEqual(['company-settings', 'users', 'whatsapp'])
  })

  it('lets a read-only member view records and the audit log, and change nothing', () => {
    expect(ids('read_only')).toEqual(['view-records', 'view-members', 'audit-log'])
  })

  it('lets a property owner view records but not the audit log', () => {
    expect(ids('property_owner')).toEqual(['view-records', 'view-members'])
  })

  it('never lets a role that cannot write approve tenant messages', () => {
    const approve = ROLE_CAPABILITIES.find((capability) => capability.id === 'approve-messages')
    for (const role of USER_ROLES) expect(approve?.allows(role)).toBe(isCompanyWriter(role))
  })

  it('has unique ids', () => {
    expect(new Set(ROLE_CAPABILITIES.map((c) => c.id)).size).toBe(ROLE_CAPABILITIES.length)
  })
})

describe('role checks', () => {
  it.each([
    ['company_admin', true, true, true],
    ['property_manager', false, true, true],
    ['read_only', false, false, true],
    ['property_owner', false, false, false],
  ] as const)('%s: admin %s, writer %s, audit reader %s', (role, admin, writer, audit) => {
    expect(isCompanyAdmin(role)).toBe(admin)
    expect(isCompanyWriter(role)).toBe(writer)
    expect(canReadAuditLog(role)).toBe(audit)
  })

  it('treats no role as no access', () => {
    expect(canReadAuditLog(null)).toBe(false)
  })
})
