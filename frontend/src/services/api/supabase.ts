import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { captureAuthCallback, shouldDetectSessionInUrl } from '@/services/api/authCallback'
import { getAppConfig } from '@/services/api/config'

let client: SupabaseClient | null = null

/**
 * Browser Supabase client, used for authentication only (data goes through the LeaseGuard API).
 * Created lazily on first use.
 *
 * Invitation and password-recovery emails link to `/auth/accept` and `/auth/reset-password` with the
 * session in the URL (implicit flow, see `authCallback.ts`). The client reads it from those pages only;
 * the link type is captured just before, because the client removes it from the URL.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const config = getAppConfig()
  if (typeof window !== 'undefined') captureAuthCallback(window.location.href)
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Service-role invite links and recovery links are implicit-flow URLs (`#access_token=…`).
      flowType: 'implicit',
      detectSessionInUrl: shouldDetectSessionInUrl,
    },
  })
  return client
}

/** Current access token, or null when signed out. supabase-js refreshes an expired token here. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session?.access_token ?? null
}
