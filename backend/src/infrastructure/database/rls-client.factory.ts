import { Inject, Injectable } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import type { Database } from './database.types'
import { SERVER_AUTH_OPTIONS, SupabaseNotConfiguredError } from './supabase-config'

/** Supabase client typed with the generated public schema (`pnpm db:types`). */
export type DbClient = SupabaseClient<Database>

/**
 * Supabase clients for the API process. Every database client is created with the anon key plus the
 * caller's own access token, so Postgres Row Level Security decides what each request may read or
 * write. The API never holds the service-role key.
 */
@Injectable()
export class RlsClientFactory {
  private verifier: SupabaseClient<Database> | undefined

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Database client bound to one caller. Create it per request; never share it between users. */
  forAccessToken(accessToken: string): DbClient {
    return createClient<Database>(this.env.SUPABASE_URL, this.anonKey(), {
      auth: SERVER_AUTH_OPTIONS,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
  }

  /** Long-lived anon client used only to verify access tokens; it caches the project's JWKS. */
  tokenVerifier(): SupabaseClient<Database> {
    this.verifier ??= createClient<Database>(this.env.SUPABASE_URL, this.anonKey(), { auth: SERVER_AUTH_OPTIONS })
    return this.verifier
  }

  private anonKey(): string {
    if (!this.env.SUPABASE_ANON_KEY) throw new SupabaseNotConfiguredError('SUPABASE_ANON_KEY')
    return this.env.SUPABASE_ANON_KEY
  }
}
