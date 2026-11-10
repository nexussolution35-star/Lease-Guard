import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult } from '../../common/testing/fake-db.test-helpers'
import { companyRow } from '../companies/companies.test-helpers'
import { membershipRow, profileRow } from '../users/users.test-helpers'
import { AuthService } from './auth.service'
import { updateMeBodySchema } from './auth.schemas'

const USER = profileRow.id
const membershipWithCompany = {
  ...membershipRow,
  company: { id: companyRow.id, name: companyRow.name, trading_name: null, initials: 'NS', status: 'active' },
}

function respondByTable(profile: FakeResult, memberships: FakeResult) {
  return fakeDb((query) => (query.table === 'profiles' ? profile : memberships))
}

describe('AuthService.me', () => {
  const service = new AuthService()

  it('reads the caller profile and memberships, both filtered by the caller id', async () => {
    const { client, queries } = respondByTable(
      { data: profileRow, error: null },
      { data: [membershipWithCompany], error: null },
    )

    const me = await service.me(client, USER)

    expect(me).toMatchObject({
      id: USER,
      fullName: 'Sipho Dlamini',
      memberships: [{ companyId: companyRow.id, role: 'property_manager', isDefault: true, company: { initials: 'NS' } }],
    })

    const profileQuery = queries.find((q) => q.table === 'profiles')
    const membershipQuery = queries.find((q) => q.table === 'company_users')
    expect(callsTo(profileQuery!, 'eq')).toEqual([['id', USER]])
    expect(callsTo(membershipQuery!, 'eq')).toEqual([['user_id', USER]])
    expect(callsTo(membershipQuery!, 'select')[0]?.[0]).toContain('company:companies!inner(')
    expect(callsTo(membershipQuery!, 'order')[0]).toEqual(['is_default', { ascending: false }])
  })

  it('returns 404 when the caller has no profile', async () => {
    const { client } = respondByTable({ data: null, error: null }, { data: [], error: null })
    await expect(service.me(client, USER)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps a failed membership query to an HTTP error instead of returning no workspaces', async () => {
    const { client } = respondByTable(
      { data: profileRow, error: null },
      { data: null, error: { code: 'PGRST002', message: 'schema cache' } },
    )
    await expect(service.me(client, USER)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('updateMeBodySchema', () => {
  it('normalises values and rejects bad input', () => {
    expect(updateMeBodySchema.parse({ fullName: '  Thandi M ', whatsappNumber: '+27 82 123 4567', phone: '' })).toEqual({
      fullName: 'Thandi M',
      whatsappNumber: '+27821234567',
      phone: null,
    })
    expect(updateMeBodySchema.safeParse({}).success).toBe(false)
    expect(updateMeBodySchema.safeParse({ whatsappNumber: '0821234567' }).success).toBe(false)
    expect(updateMeBodySchema.safeParse({ status: 'active' }).success).toBe(false)
    expect(updateMeBodySchema.safeParse({ fullName: '' }).success).toBe(false)
  })
})

describe('AuthService.updateMe', () => {
  it("updates only the caller's own row and the user-editable columns, then returns the profile", async () => {
    const { client, queries } = fakeDb((query) =>
      query.table === 'profiles' ? { data: profileRow, error: null } : { data: [], error: null },
    )
    const profile = await new AuthService().updateMe(client, USER, updateMeBodySchema.parse({ fullName: 'New Name', jobTitle: '' }))

    const update = queries.find((query) => callsTo(query, 'update').length > 0)
    expect(callsTo(update!, 'update')).toEqual([[{ full_name: 'New Name', job_title: null }]])
    expect(callsTo(update!, 'eq')).toEqual([['id', USER]])
    expect(profile.id).toBe(USER)
  })

  it('returns 404 when the profile row is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(new AuthService().updateMe(client, USER, updateMeBodySchema.parse({ fullName: 'X' }))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
