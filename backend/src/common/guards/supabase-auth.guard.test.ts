import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { SupabaseNotConfiguredError } from '../../infrastructure/database/supabase-config'
import { Public } from '../decorators/public.decorator'
import type { LeaseGuardRequest } from '../request-context'
import { fakeClients, httpContext } from './guards.test-helpers'
import { SupabaseAuthGuard } from './supabase-auth.guard'

const USER_ID = '6f1d1d3e-8a51-4a5e-9d0c-6a1f3c1b2a10'
const validClaims = { data: { claims: { sub: USER_ID, role: 'authenticated', email: 'pm@nexus.co.za' } }, error: null }

function guardWith(options: Parameters<typeof fakeClients>[0]) {
  return new SupabaseAuthGuard(new Reflector(), fakeClients(options).factory)
}

describe('SupabaseAuthGuard', () => {
  it('attaches the verified user for a valid bearer token', async () => {
    const getClaims = vi.fn(async () => validClaims)
    const request: Partial<LeaseGuardRequest> = { headers: { authorization: 'Bearer good.jwt.token' } }
    await expect(guardWith({ getClaims }).canActivate(httpContext(request))).resolves.toBe(true)
    expect(getClaims).toHaveBeenCalledWith('good.jwt.token')
    expect(request.user).toEqual({ userId: USER_ID, email: 'pm@nexus.co.za', accessToken: 'good.jwt.token' })
  })

  it('rejects a request without a bearer token', async () => {
    const getClaims = vi.fn()
    const guard = guardWith({ getClaims })
    await expect(guard.canActivate(httpContext({ headers: {} }))).rejects.toThrow(UnauthorizedException)
    await expect(guard.canActivate(httpContext({ headers: { authorization: 'Basic abc' } }))).rejects.toThrow(
      UnauthorizedException,
    )
    expect(getClaims).not.toHaveBeenCalled()
  })

  it('rejects an invalid or expired token', async () => {
    const getClaims = async () => ({ data: null, error: new Error('invalid JWT') })
    await expect(
      guardWith({ getClaims }).canActivate(httpContext({ headers: { authorization: 'Bearer forged' } })),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('rejects tokens that are not signed-in user tokens (anon or service-role keys)', async () => {
    const getClaims = async () => ({ data: { claims: { role: 'anon' } }, error: null })
    await expect(
      guardWith({ getClaims }).canActivate(httpContext({ headers: { authorization: 'Bearer anon.key' } })),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('answers 503 rather than 401 when Supabase Auth is unreachable or not configured', async () => {
    const unreachable = async () => ({ data: null, error: new AuthRetryableFetchError('fetch failed', 0) })
    const request = { headers: { authorization: 'Bearer good.jwt.token' } }
    await expect(guardWith({ getClaims: unreachable }).canActivate(httpContext(request))).rejects.toThrow(
      ServiceUnavailableException,
    )
    const notConfigured = new SupabaseNotConfiguredError('SUPABASE_ANON_KEY')
    await expect(guardWith({ notConfigured }).canActivate(httpContext(request))).rejects.toThrow(
      ServiceUnavailableException,
    )
  })

  it('lets @Public() routes through without a token', async () => {
    class HealthLikeController {
      @Public()
      check(): void {}
    }
    const getClaims = vi.fn()
    const context = httpContext({ headers: {} }, HealthLikeController.prototype.check, HealthLikeController)
    await expect(guardWith({ getClaims }).canActivate(context)).resolves.toBe(true)
    expect(getClaims).not.toHaveBeenCalled()
  })
})
