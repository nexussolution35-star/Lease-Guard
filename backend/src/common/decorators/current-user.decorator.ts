import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { AuthenticatedUser, LeaseGuardRequest } from '../request-context'

/** The verified caller. Only valid on routes protected by SupabaseAuthGuard (the global default). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const user = ctx.switchToHttp().getRequest<LeaseGuardRequest>().user
  if (!user) throw new Error('@CurrentUser() used on a route without SupabaseAuthGuard')
  return user
})
