import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { UserRole } from '@leaseguard/domain'

import type { LeaseGuardRequest } from '../request-context'

export const COMPANY_ROLES_KEY = 'leaseguard:companyRoles'

/**
 * Rejects callers whose role in the active company is not allowed by `@CompanyScoped({ roles })`.
 * Runs after CompanyAccessGuard. It gives a clear 403 early; Row Level Security still enforces the
 * same rule in the database (`private.can_write`).
 */
@Injectable()
export class CompanyRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(COMPANY_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!roles || roles.length === 0) return true
    const company = context.switchToHttp().getRequest<LeaseGuardRequest>().company
    if (!company || !roles.includes(company.role)) {
      throw new ForbiddenException('Your role does not allow this action')
    }
    return true
  }
}
