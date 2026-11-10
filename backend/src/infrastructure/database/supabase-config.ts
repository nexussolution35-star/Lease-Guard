/** Thrown when a Supabase key is still empty (for example before `supabase start` in local dev). */
export class SupabaseNotConfiguredError extends Error {
  constructor(variable: 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY') {
    super(`${variable} is not set; start Supabase and copy the key into the repository-root .env`)
    this.name = 'SupabaseNotConfiguredError'
  }
}

/** Server-side clients never persist or refresh sessions; each request carries its own token. */
export const SERVER_AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const
