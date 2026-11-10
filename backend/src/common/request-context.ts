import type { EntityId, UserRole } from '@leaseguard/domain'
import type { Request } from 'express'

import type { DbClient } from '../infrastructure/database/rls-client.factory'

/** Caller identity established by SupabaseAuthGuard from a verified Supabase access token. */
export interface AuthenticatedUser {
  userId: EntityId
  email: string | null
  /** The caller's bearer token, forwarded to Supabase so Row Level Security applies to their queries. */
  accessToken: string
}

/** Active company established by CompanyAccessGuard after verifying membership. */
export interface CompanyContext {
  companyId: EntityId
  role: UserRole
}

/** Express request after the guards ran. pino-http adds the request id as `id`. */
export interface LeaseGuardRequest extends Request {
  user?: AuthenticatedUser
  company?: CompanyContext
  /** Database client bound to the caller's token (RLS applies). Set by SupabaseAuthGuard. */
  db?: DbClient
}
