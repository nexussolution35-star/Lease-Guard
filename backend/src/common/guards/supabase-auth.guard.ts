import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'

import { RlsClientFactory } from '../../infrastructure/database/rls-client.factory'
import { SupabaseNotConfiguredError } from '../../infrastructure/database/supabase-config'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import type { LeaseGuardRequest } from '../request-context'

const BEARER = /^Bearer\s+(\S+)$/i

/**
 * Global guard: every route requires a valid Supabase access token unless marked @Public().
 *
 * Verification uses supabase-js `auth.getClaims(token)`. With asymmetric signing keys it verifies the
 * signature locally against the project's cached JWKS (no per-request round trip); with a legacy
 * symmetric secret it falls back to asking the Auth server. Only tokens issued to signed-in users
 * (role `authenticated` with a subject) are accepted, so the anon and service-role keys are refused.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly clients: RlsClientFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<LeaseGuardRequest>()
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1]
    if (!token) throw new UnauthorizedException('A bearer access token is required')

    let verifier
    try {
      verifier = this.clients.tokenVerifier()
    } catch (error) {
      if (error instanceof SupabaseNotConfiguredError) {
        this.logger.error(error.message)
        throw new ServiceUnavailableException('Authentication is not available')
      }
      throw error
    }

    const { data, error } = await verifier.auth.getClaims(token)
    if (error && isAuthRetryableFetchError(error)) {
      this.logger.error(`Supabase Auth unreachable while verifying a token: ${error.message}`)
      throw new ServiceUnavailableException('Authentication is not available')
    }
    const claims = data?.claims
    if (error || !claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub) {
      throw new UnauthorizedException('Invalid or expired access token')
    }

    request.user = {
      userId: claims.sub,
      email: typeof claims.email === 'string' && claims.email ? claims.email : null,
      accessToken: token,
    }
    // One RLS-bound client per request, reused by CompanyAccessGuard and the route handler.
    request.db = this.clients.forAccessToken(token)
    return true
  }
}
