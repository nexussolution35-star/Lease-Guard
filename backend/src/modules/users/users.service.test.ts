import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { membershipRow, profileRow } from './users.test-helpers'
import { updateMemberRoleBodySchema, userListQuerySchema } from './users.schemas'
import { UsersService } from './users.service'

const COMPANY = membershipRow.company_id

describe('UsersService', () => {
  const service = new UsersService()

  it('lists members of one company with role/status filters, profile search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({ data: [{ ...membershipRow, profile: profileRow }], error: null, count: 12 }))
    const query = userListQuerySchema.parse({
      page: '2',
      pageSize: '5',
      search: 'sipho',
      role: 'property_manager',
      status: 'active',
      sort: 'fullName',
      direction: 'desc',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 12, page: 2, pageSize: 5 })
    expect(page.items).toEqual([
      expect.objectContaining({
        id: profileRow.id,
        fullName: 'Sipho Dlamini',
        memberships: [{ companyId: COMPANY, role: 'property_manager', isDefault: true, joinedAt: membershipRow.joined_at }],
      }),
    ])

    const [q] = queries
    expect(q?.table).toBe('company_users')
    expect(callsTo(q!, 'select')[0]?.[0]).toContain('profile:profiles!inner(*)')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['role', 'property_manager'],
      ['profile.status', 'active'],
    ])
    expect(callsTo(q!, 'or')).toEqual([
      ['full_name.ilike."%sipho%",email.ilike."%sipho%",job_title.ilike."%sipho%"', { referencedTable: 'profile' }],
    ])
    expect(callsTo(q!, 'order')).toEqual([
      ['profile(full_name)', { ascending: false }],
      ['user_id', { ascending: true }],
    ])
    expect(callsTo(q!, 'range')).toEqual([[5, 9]])
  })

  it('sorts by a membership column without touching the profile embed', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    const page = await service.list(client, COMPANY, userListQuerySchema.parse({ sort: 'joinedAt' }))

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 25 })
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['joined_at', { ascending: true }])
    expect(callsTo(queries[0]!, 'or')).toEqual([])
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, userListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})

const ADMIN = '6f1d2c1e-0000-4000-8000-0000000000a1'
const MEMBER = profileRow.id
const LAST_ADMIN = { code: 'P0001', message: 'a company must keep at least one active company admin; make another member company admin first' }

describe('UsersService.updateRole', () => {
  const service = new UsersService()
  const body = updateMemberRoleBodySchema.parse({ role: 'read_only' })

  it("updates only the member's role in the active company and returns the member", async () => {
    const { client, queries } = fakeDb(() => ({ data: { ...membershipRow, role: 'read_only', profile: profileRow }, error: null }))

    const user = await service.updateRole(client, COMPANY, ADMIN, MEMBER, body)

    expect(user).toMatchObject({ id: MEMBER, memberships: [{ companyId: COMPANY, role: 'read_only' }] })
    const [q] = queries
    expect(q?.table).toBe('company_users')
    expect(callsTo(q!, 'update')).toEqual([[{ role: 'read_only' }]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['user_id', MEMBER],
    ])
    expect(callsTo(q!, 'select')[0]?.[0]).toContain('profile:profiles!inner(*)')
  })

  it('refuses a change of the caller\'s own role without querying (any letter case)', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.updateRole(client, COMPANY, ADMIN, ADMIN.toUpperCase(), body)).rejects.toBeInstanceOf(ForbiddenException)
    expect(queries).toHaveLength(0)
  })

  it('maps demoting the last active company admin (P0001) to 409 with the database message', async () => {
    const { client } = fakeDb(() => ({ data: null, error: LAST_ADMIN }))
    const error = await service.updateRole(client, COMPANY, ADMIN, MEMBER, body).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toBe(LAST_ADMIN.message)
  })

  it('maps a database refusal (42501) to 403', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: '42501', message: 'you cannot change your own role' } }))
    await expect(service.updateRole(client, COMPANY, ADMIN, MEMBER, body)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('returns 404 for a user who is not a member of the active company', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.updateRole(client, COMPANY, ADMIN, MEMBER, body)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('accepts only known roles', () => {
    expect(updateMemberRoleBodySchema.safeParse({ role: 'owner' }).success).toBe(false)
    expect(updateMemberRoleBodySchema.safeParse({ role: 'read_only', userId: MEMBER }).success).toBe(false)
  })
})

describe('UsersService.remove', () => {
  const service = new UsersService()

  it('deletes only the membership in the active company', async () => {
    const { client, queries } = fakeDb(() => ({ data: { user_id: MEMBER }, error: null }))

    await expect(service.remove(client, COMPANY, ADMIN, MEMBER)).resolves.toBeUndefined()

    const [q] = queries
    expect(q?.table).toBe('company_users')
    expect(callsTo(q!, 'delete')).toEqual([[]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['user_id', MEMBER],
    ])
  })

  it('refuses to remove the caller without querying', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.remove(client, COMPANY, ADMIN, ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
    expect(queries).toHaveLength(0)
  })

  it('maps removing the last active company admin (P0001) to 409', async () => {
    const { client } = fakeDb(() => ({ data: null, error: LAST_ADMIN }))
    await expect(service.remove(client, COMPANY, ADMIN, MEMBER)).rejects.toBeInstanceOf(ConflictException)
  })

  it('maps a member still referenced by company records (23503) to 409 with a clear message', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: '23503', message: 'violates foreign key constraint "properties_manager_fk"' } }))
    const error = await service.remove(client, COMPANY, ADMIN, MEMBER).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toMatch(/reassign/)
    expect((error as ConflictException).message).not.toContain('properties_manager_fk')
  })

  it('keeps the default mapping for other errors', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: '23514', message: 'check' } }))
    await expect(service.remove(client, COMPANY, ADMIN, MEMBER)).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('returns 404 when no membership was removed', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.remove(client, COMPANY, ADMIN, MEMBER)).rejects.toBeInstanceOf(NotFoundException)
  })
})
