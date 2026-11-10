import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

import { COMPANY_ROLES_KEY, CompanyRoleGuard } from './company-role.guard'
import { httpContext } from './guards.test-helpers'

function handlerWithRoles(roles?: string[]): () => void {
  const handler = (): void => undefined
  if (roles) Reflect.defineMetadata(COMPANY_ROLES_KEY, roles, handler)
  return handler
}

describe('CompanyRoleGuard', () => {
  const guard = new CompanyRoleGuard(new Reflector())
  const company = { companyId: 'c1', role: 'read_only' as const }

  it('allows any member when no roles are required', () => {
    expect(guard.canActivate(httpContext({ company }, handlerWithRoles()))).toBe(true)
    expect(guard.canActivate(httpContext({ company }, handlerWithRoles([])))).toBe(true)
  })

  it('allows listed roles and rejects others', () => {
    const writers = handlerWithRoles(['company_admin', 'property_manager'])
    expect(guard.canActivate(httpContext({ company: { companyId: 'c1', role: 'property_manager' } }, writers))).toBe(true)
    expect(() => guard.canActivate(httpContext({ company }, writers))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(httpContext({}, writers))).toThrow(ForbiddenException)
  })
})
