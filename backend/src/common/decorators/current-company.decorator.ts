import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { CompanyContext, LeaseGuardRequest } from '../request-context'

/** The company named by X-Company-Id, after CompanyAccessGuard verified the caller's membership. */
export const CurrentCompany = createParamDecorator((_data: unknown, ctx: ExecutionContext): CompanyContext => {
  const company = ctx.switchToHttp().getRequest<LeaseGuardRequest>().company
  if (!company) throw new Error('@CurrentCompany() used on a route without CompanyAccessGuard')
  return company
})
