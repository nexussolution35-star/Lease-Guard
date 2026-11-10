/**
 * Guards against shipping a server-only secret to the browser. Vite inlines every `VITE_*` variable into
 * the JavaScript bundle, so a Supabase service-role or secret key, the Meta app secret, the WhatsApp
 * webhook verify token, a WhatsApp access token or the Anthropic API key placed in one by mistake would
 * be public.
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

/** Settings only server processes may hold; a `VITE_` copy of any of them is refused by name. */
export const SERVER_ONLY_SETTINGS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'ANTHROPIC_API_KEY',
] as const
const SERVER_ONLY_PREFIXES = ['WHATSAPP_ACCESS_TOKEN'] as const
// Anthropic API keys start with this prefix.
const ANTHROPIC_KEY_PREFIX = 'sk-ant-'

function namesServerOnlySetting(viteName: string): boolean {
  const name = viteName.slice('VITE_'.length)
  return (SERVER_ONLY_SETTINGS as readonly string[]).includes(name) || SERVER_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/**
 * Names (never values) of `VITE_*` variables that hold or name a server-only secret, sorted: a Supabase
 * secret key, a `VITE_` copy of a server-only setting, an Anthropic-shaped key, or a value equal to one of
 * `serverSecrets` (vite.config.ts passes the server-only settings it can see; values are only compared).
 */
export function findExposedSecrets(
  env: Readonly<Record<string, unknown>>,
  serverSecrets: Readonly<Record<string, string | undefined>> = {},
): string[] {
  const secretValues = new Set(
    Object.values(serverSecrets)
      .map((value) => value?.trim() ?? '')
      .filter((value) => value !== ''),
  )
  return Object.entries(env)
    .filter(([name, value]) => {
      if (!name.startsWith('VITE_')) return false
      if (namesServerOnlySetting(name)) return true
      if (typeof value !== 'string') return false
      const candidate = value.trim()
      return isSupabaseSecretKey(candidate) || candidate.startsWith(ANTHROPIC_KEY_PREFIX) || secretValues.has(candidate)
    })
    .map(([name]) => name)
    .sort()
}

export function exposedSecretsMessage(names: readonly string[]): string {
  return (
    `${names.join(', ')} ${names.length === 1 ? 'holds' : 'hold'} a server-only secret (a Supabase secret or service-role key, ` +
    'the Meta app secret, the webhook verify token, a WhatsApp access token or the Anthropic API key). ' +
    'VITE_* variables are bundled into the browser; use the public anon/publishable key only.'
  )
}
