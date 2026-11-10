import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { LeaseGuardRequest } from '../request-context'

/**
 * The database client bound to the caller's access token. Every API query goes through it, so Row
 * Level Security decides what the caller may read or write. Set by the global SupabaseAuthGuard.
 */
export const UserDb = createParamDecorator((_data: unknown, ctx: ExecutionContext): DbClient => {
  const db = ctx.switchToHttp().getRequest<LeaseGuardRequest>().db
  if (!db) throw new Error('@UserDb() used on a route without SupabaseAuthGuard')
  return db
})
