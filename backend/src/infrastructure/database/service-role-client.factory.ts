import { Inject, Injectable } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import type { Database } from './database.types'
import type { DbClient } from './rls-client.factory'
import { SERVER_AUTH_OPTIONS, SupabaseNotConfiguredError } from './supabase-config'

/**
 * Service-role Supabase client for the WORKER process only. It bypasses Row Level Security, so:
 *
 * - every query MUST filter by `company_id` explicitly (`.eq('company_id', job.companyId)`), and every
 *   insert MUST set `company_id` from the job payload, never from data read without that filter;
 * - it is registered only in WorkersModule and must never be provided to the API module or reach the
 *   frontend.
 */
@Injectable()
export class ServiceRoleClientFactory {
  private cached: SupabaseClient<Database> | undefined

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  /** The shared service-role client. Throws SupabaseNotConfiguredError while the key is empty. */
  get(): DbClient {
    if (!this.env.SUPABASE_SERVICE_ROLE_KEY) throw new SupabaseNotConfiguredError('SUPABASE_SERVICE_ROLE_KEY')
    this.cached ??= createClient<Database>(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, { auth: SERVER_AUTH_OPTIONS })
    return this.cached
  }
}
