import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

/** Supabase client typed with the generated public schema (`pnpm db:types`). */
export type DbClient = SupabaseClient<Database>

/**
 * The RLS-bound client factory is shared by every service (@leaseguard/service-kit, ADR 0003): each client is created
 * with the anon key plus the caller's own access token, so Row Level Security decides what a request may read or write.
 */
export { RlsClientFactory } from '@leaseguard/service-kit'
