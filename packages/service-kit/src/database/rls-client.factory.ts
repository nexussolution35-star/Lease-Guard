import { Inject, Injectable } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SERVICE_SETTINGS, type ServiceSettings } from '../settings'
import { SERVER_AUTH_OPTIONS, SupabaseNotConfiguredError } from './supabase-config'

/**
 * A Supabase client bound to one caller. Untyped here: each service types it with its own generated schema
 * (the core service's `DbClient` is `SupabaseClient<Database>` from `pnpm db:types`).
 */
export type DbClient = SupabaseClient

/**
 * Supabase clients for an HTTP service. Every database client is created with the anon key plus the
 * caller's own access token, so Postgres Row Level Security decides what each request may read or
 * write. HTTP services never hold the service-role key.
 */
@Injectable()
export class RlsClientFactory {
  private verifier: SupabaseClient | undefined

  constructor(@Inject(SERVICE_SETTINGS) private readonly settings: ServiceSettings) {}

  /** Database client bound to one caller. Create it per request; never share it between users. */
  forAccessToken(accessToken: string): DbClient {
    return createClient(this.settings.supabaseUrl, this.anonKey(), {
      auth: SERVER_AUTH_OPTIONS,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
  }

  /** Long-lived anon client used only to verify access tokens; it caches the project's JWKS. */
  tokenVerifier(): SupabaseClient {
    this.verifier ??= createClient(this.settings.supabaseUrl, this.anonKey(), { auth: SERVER_AUTH_OPTIONS })
    return this.verifier
  }

  private anonKey(): string {
    if (!this.settings.supabaseAnonKey) throw new SupabaseNotConfiguredError('SUPABASE_ANON_KEY')
    return this.settings.supabaseAnonKey
  }
}
