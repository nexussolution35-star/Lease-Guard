import { createApiClient, type ApiClient } from '@leaseguard/api-client'

import { getAppConfig } from '@/services/api/config'
import { getAccessToken, getSupabaseClient } from '@/services/api/supabase'
import { getActiveCompanyIdOrNull } from '@/store/appStore'

let client: ApiClient | null = null

/**
 * The single LeaseGuard API client. Sends the Supabase access token and the active workspace as
 * `X-Company-Id` (data sources may also pass the company explicitly per request). A 401 signs the
 * user out locally; the auth provider then redirects to /login.
 */
export function getApiClient(): ApiClient {
  if (client) return client
  const config = getAppConfig()
  client = createApiClient({
    baseUrl: config.apiUrl,
    getAccessToken,
    getCompanyId: getActiveCompanyIdOrNull,
    onUnauthorized: () => {
      // `local` clears the stored session without another request carrying the rejected token.
      void getSupabaseClient().auth.signOut({ scope: 'local' })
    },
  })
  return client
}
