import { createApiClient, isApiError, type ApiClient, type ApiError } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'

import type { World, WorldCompanyKey, WorldUserKey } from '../../fixtures/world.ts'
import type { IntegrationContext } from './context.ts'

export function integration(): IntegrationContext {
  return inject('integration')
}

/** The companies, users and records this run created. */
export function world(): World {
  return integration().world
}

/**
 * The typed API client acting as one of the world's users (or anonymously with `null`), with the
 * active company sent as X-Company-Id. `company` is a world company key ('a' | 'b') or any company id.
 */
export function apiAs(user: WorldUserKey | null, company?: WorldCompanyKey | string): ApiClient {
  const ctx = integration()
  const token = user ? ctx.accessTokens[user] : null
  const companyId = company === undefined ? null : company === 'a' || company === 'b' ? ctx.world.companies[company].id : company
  return createApiClient({ baseUrl: ctx.apiBaseUrl, getAccessToken: () => token, getCompanyId: () => companyId })
}

let serviceClient: SupabaseClient | undefined

/** Service-role Supabase client for test SETUP AND CLEANUP ONLY (bypasses RLS). Never an API caller. */
export function serviceRole(): SupabaseClient {
  const ctx = integration()
  serviceClient ??= createClient(ctx.supabaseUrl, ctx.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return serviceClient
}

/** Anon-key Supabase client (RLS applies), e.g. to upload to a signed upload URL like a browser does. */
export function anonSupabase(): SupabaseClient {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Awaits a call that must fail and returns its ApiError. */
export async function apiErrorOf(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call
  } catch (error) {
    if (isApiError(error)) return error
    throw error
  }
  throw new Error('Expected the API call to fail, but it succeeded')
}

/** The data of a setup/cleanup query; throws with the Supabase error, or when it returned nothing. */
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error(`${what} returned no data`)
  return result.data
}

/** Throws with the Supabase error when a setup/cleanup write failed (writes may return no data). */
export function expectOk(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
}
