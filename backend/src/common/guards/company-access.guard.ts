import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { USER_ROLES } from '@leaseguard/domain'
import { z } from 'zod'

import { RlsClientFactory } from '../../infrastructure/database/rls-client.factory'
import type { LeaseGuardRequest } from '../request-context'

export const COMPANY_ID_HEADER = 'x-company-id'

const membershipSchema = z.object({ role: z.enum(USER_ROLES) })

/**
 * Route guard for company-owned resources: reads the active company from the X-Company-Id header and
 * verifies that the caller is a member, querying `company_users` through the caller's RLS-bound client
 * (inactive profiles are not members under RLS). Apply after the global SupabaseAuthGuard with
 * `@UseGuards(CompanyAccessGuard)`; read the result with `@CurrentCompany()`.
 *
 * This is the API boundary check only. Row Level Security on every company-owned table remains the
 * enforcement layer; queries must still be made through the same RLS-bound client.
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  private readonly logger = new Logger(CompanyAccessGuard.name)

  constructor(private readonly clients: RlsClientFactory) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LeaseGuardRequest>()
    if (!request.user) throw new UnauthorizedException('A bearer access token is required')

    const header = z.uuid().safeParse(request.headers[COMPANY_ID_HEADER])
    if (!header.success) throw new BadRequestException('The X-Company-Id header must be a company id (UUID)')
    // Postgres prints uuids in lowercase, and storage paths and job ids are built from this value, so it
    // is canonicalised here: `ABC…` and `abc…` must name the same company everywhere downstream.
    const companyId = header.data.toLowerCase()

    request.db ??= this.clients.forAccessToken(request.user.accessToken)
    const { data, error } = await request.db
      .from('company_users')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', request.user.userId)
      .maybeSingle()
    if (error) {
      this.logger.error(`Company membership lookup failed (${error.code}): ${error.message}`)
      throw new ServiceUnavailableException('Company access could not be verified')
    }
    if (!data) throw new ForbiddenException('You do not have access to this company')

    const membership = membershipSchema.safeParse(data)
    if (!membership.success) {
      this.logger.error(`Unknown company role ${JSON.stringify((data as { role?: unknown }).role)}`)
      throw new ForbiddenException('You do not have access to this company')
    }
    request.company = { companyId, role: membership.data.role }
    return true
  }
}
