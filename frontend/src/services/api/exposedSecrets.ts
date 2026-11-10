/**
 * Guards against shipping a Supabase secret to the browser. Vite inlines every `VITE_*` variable into
 * the JavaScript bundle, so a service-role or secret key placed in one by mistake would be public.
 *
 * Used twice: by vite.config.ts, which refuses to build or serve, and by config.ts at startup. Kept free
 * of `import.meta.env` and path aliases so the Vite config (Node) can import it too.
 */

const SECRET_KEY_PREFIX = 'sb_secret_'

function decodeJwtPayload(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return JSON.parse(atob(padded))
}

/** True for Supabase secret keys (`sb_secret_…`) and legacy service-role JWTs. */
export function isSupabaseSecretKey(value: string): boolean {
  const candidate = value.trim()
  if (candidate.startsWith(SECRET_KEY_PREFIX)) return true
  const parts = candidate.split('.')
  if (parts.length !== 3 || !parts[1]) return false
  try {
    const payload = decodeJwtPayload(parts[1])
    return typeof payload === 'object' && payload !== null && (payload as { role?: unknown }).role === 'service_role'
  } catch {
    return false
  }
}

/** Names (never values) of `VITE_*` variables holding a Supabase secret key, sorted. */
export function findExposedSecrets(env: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => name.startsWith('VITE_') && typeof value === 'string' && isSupabaseSecretKey(value))
    .map(([name]) => name)
    .sort()
}

export function exposedSecretsMessage(names: readonly string[]): string {
  return (
    `${names.join(', ')} ${names.length === 1 ? 'holds' : 'hold'} a Supabase secret or service-role key. ` +
    'VITE_* variables are bundled into the browser; use the public anon/publishable key only.'
  )
}
