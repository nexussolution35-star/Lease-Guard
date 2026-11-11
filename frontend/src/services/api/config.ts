import { z } from 'zod'

import { exposedSecretsMessage, findExposedSecrets } from './exposedSecrets'

/**
 * Frontend runtime configuration, validated once at startup from `import.meta.env`.
 *
 * Vite reads `frontend/.env` (see `envDir` in vite.config.ts), which holds public values only, and exposes
 * only `VITE_*` variables to the browser. Nothing here is secret: the Supabase anon key is public and
 * subject to Row Level Security. Other `VITE_*` variables are ignored, so an extra entry in a
 * developer's `.env` never prevents startup.
 */
export interface AppConfig {
  /** Backend origin, e.g. `http://127.0.0.1:3000`. API paths already include `/api/v1`. */
  apiUrl: string
  supabaseUrl: string
  /** Public anon key (browser-safe; RLS applies). */
  supabaseAnonKey: string
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: string[] }

/** Unset and empty variables are both "missing" (`.env.example` ships empty values). */
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)

const httpUrl = (name: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${name} is required` })
      .trim()
      .pipe(z.url({ protocol: /^https?$/, error: `${name} must be an http(s) URL` })),
  )

const envSchema = z.object({
  VITE_API_URL: httpUrl('VITE_API_URL'),
  VITE_SUPABASE_URL: httpUrl('VITE_SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY: z.preprocess(blankToUndefined, z.string({ error: 'VITE_SUPABASE_ANON_KEY is required' }).trim()),
})

/** Validate a Vite env object. Pure, so tests can pass any environment. */
export function parseAppConfig(env: Readonly<Record<string, unknown>>): ConfigResult {
  // Vite bundles every VITE_* value, so a secret in any of them is refused first.
  const exposed = findExposedSecrets(env)
  if (exposed.length > 0) return { ok: false, issues: [exposedSecretsMessage(exposed)] }

  const parsed = envSchema.safeParse(env)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) }
  const { VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = parsed.data
  return {
    ok: true,
    config: {
      apiUrl: VITE_API_URL.replace(/\/+$/, ''),
      supabaseUrl: VITE_SUPABASE_URL.replace(/\/+$/, ''),
      supabaseAnonKey: VITE_SUPABASE_ANON_KEY,
    },
  }
}

/** The validated configuration of this build. main.tsx renders a startup error screen when `ok` is false. */
export const appConfigResult: ConfigResult = parseAppConfig(import.meta.env)

export class ConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid LeaseGuard configuration: ${issues.join('; ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/** The validated configuration; throws when it is invalid (the app never renders in that case). */
export function getAppConfig(result: ConfigResult = appConfigResult): AppConfig {
  if (!result.ok) throw new ConfigError(result.issues)
  return result.config
}
