import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { LeaseGuardRequest } from '../request-context'
import { CompanyAccessGuard } from './company-access.guard'
import { fakeClients, httpContext } from './guards.test-helpers'

const USER = { userId: '6f1d1d3e-8a51-4a5e-9d0c-6a1f3c1b2a10', email: 'pm@nexus.co.za', accessToken: 'user.jwt' }
const COMPANY_ID = '0b6c7c38-3f43-4e0e-8f1e-2d5b1f6f9a01'

function request(companyHeader?: string): Partial<LeaseGuardRequest> {
  return { user: USER, headers: companyHeader === undefined ? {} : { 'x-company-id': companyHeader } }
}

describe('CompanyAccessGuard', () => {
  it('attaches the company for a member, querying company_users with the caller token', async () => {
    const { factory, queries } = fakeClients({ membership: { data: { role: 'property_manager' }, error: null } })
    const req = request(COMPANY_ID)
    await expect(new CompanyAccessGuard(factory).canActivate(httpContext(req))).resolves.toBe(true)
    expect(req.company).toEqual({ companyId: COMPANY_ID, role: 'property_manager' })
    expect(queries).toEqual([
      {
        table: 'company_users',
        columns: 'role',
        filters: [
          ['company_id', COMPANY_ID],
          ['user_id', USER.userId],
        ],
        accessToken: 'user.jwt',
      },
    ])
  })

  it('stores an uppercase X-Company-Id as the canonical lowercase id', async () => {
    const { factory, queries } = fakeClients({ membership: { data: { role: 'company_admin' }, error: null } })
    const req = request(COMPANY_ID.toUpperCase())
    await expect(new CompanyAccessGuard(factory).canActivate(httpContext(req))).resolves.toBe(true)
    expect(req.company).toEqual({ companyId: COMPANY_ID, role: 'company_admin' })
    expect(queries[0]?.filters).toContainEqual(['company_id', COMPANY_ID])
  })

  it('forbids a caller who is not a member of the company', async () => {
    const { factory } = fakeClients({ membership: { data: null, error: null } })
    const req = request(COMPANY_ID)
    await expect(new CompanyAccessGuard(factory).canActivate(httpContext(req))).rejects.toThrow(ForbiddenException)
    expect(req.company).toBeUndefined()
  })

  it('forbids a membership with an unknown role', async () => {
    const { factory } = fakeClients({ membership: { data: { role: 'superuser' }, error: null } })
    await expect(new CompanyAccessGuard(factory).canActivate(httpContext(request(COMPANY_ID)))).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('requires a UUID X-Company-Id header before querying', async () => {
    const { factory, queries } = fakeClients({})
    const guard = new CompanyAccessGuard(factory)
    await expect(guard.canActivate(httpContext(request()))).rejects.toThrow(BadRequestException)
    await expect(guard.canActivate(httpContext(request('cmp_nexus')))).rejects.toThrow(BadRequestException)
    expect(queries).toHaveLength(0)
  })

  it('requires an authenticated user', async () => {
    const { factory } = fakeClients({})
    await expect(
      new CompanyAccessGuard(factory).canActivate(httpContext({ headers: { 'x-company-id': COMPANY_ID } })),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('answers 503 without leaking the database error when the lookup fails', async () => {
    const { factory } = fakeClients({
      membership: { data: null, error: { code: '42P01', message: 'relation "company_users" does not exist' } },
    })
    const result = new CompanyAccessGuard(factory).canActivate(httpContext(request(COMPANY_ID)))
    await expect(result).rejects.toThrow(ServiceUnavailableException)
    await expect(result).rejects.not.toThrow(/company_users/)
  })
})
