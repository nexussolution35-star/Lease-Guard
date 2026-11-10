/**
 * Supabase Auth email links (invitation and password recovery) land on the app's `/auth/*` pages with
 * the session in the URL. supabase-js 2.119 (auth-js `GoTrueClient._initialize`) reads it on client
 * creation and removes it from the URL, so the link's type is captured here first, just before the
 * client is created (see `supabase.ts`).
 *
 * Which flow carries the session: links generated with the service role (`inviteUserByEmail`,
 * `generateLink`) and `resetPasswordForEmail` from a client configured with `flowType: 'implicit'`
 * use the implicit flow: `#access_token=…&refresh_token=…&type=invite|recovery`. A failed or reused
 * link carries `#error=access_denied&error_code=otp_expired&error_description=…` instead (also in the
 * query string for PKCE redirects). An admin-generated invite can never be a PKCE `?code=` link (no
 * code verifier exists in the browser), and a client configured for PKCE rejects implicit URLs, so the
 * browser client stays on the implicit flow.
 */

/** App pages that receive Supabase Auth links; supabase-js only reads sessions from URLs on these. */
export const AUTH_CALLBACK_PATH_PREFIX = '/auth/'

export interface AuthCallbackError {
  /** Supabase `error_code`, e.g. `otp_expired`; `unknown` when the link gave none. */
  code: string
  /** Supabase's description; shown only as supporting detail. */
  description: string
}

/** What an auth link put in the URL. */
export interface AuthCallback {
  /** The link type (`invite`, `recovery`, `signup`, `magiclink`, …) when the URL carried a session. */
  type: string | null
  /** True when the URL carried tokens (implicit flow) or a code (PKCE). */
  hasSession: boolean
  error: AuthCallbackError | null
}

/** Kinds of link that let the user choose a password without the current one. */
export type PasswordSetupKind = 'invite' | 'recovery'

export function isAuthCallbackPath(pathname: string): boolean {
  return pathname.startsWith(AUTH_CALLBACK_PATH_PREFIX)
}

/** Hash and query parameters of a URL, as supabase-js reads them (the hash wins). */
function urlParameters(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search)
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  for (const [key, value] of new URLSearchParams(hash)) params.set(key, value)
  return params
}

/** The auth link data in `href`, or null when it carries none (or is not on an `/auth/` page). */
export function parseAuthCallback(href: string): AuthCallback | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!isAuthCallbackPath(url.pathname)) return null
  const params = urlParameters(url)
  const errorCode = params.get('error_code')
  const errorDescription = params.get('error_description')
  const hasError = params.has('error') || errorCode !== null || errorDescription !== null
  const hasSession = params.has('access_token') || params.has('code')
  if (!hasError && !hasSession) return null
  return {
    type: params.get('type'),
    hasSession: hasSession && !hasError,
    error: hasError ? { code: errorCode || params.get('error') || 'unknown', description: errorDescription ?? '' } : null,
  }
}

/** True when supabase-js should read a session from this URL (only auth link pages). */
export function shouldDetectSessionInUrl(url: URL, params: Readonly<Record<string, string>>): boolean {
  return isAuthCallbackPath(url.pathname) && Boolean(params.access_token || params.error || params.error_description || params.error_code)
}

// ------------------------------------------------------------------ password setup marker

/**
 * After an invitation or recovery link the user must choose a password. The marker survives a reload
 * of the tab (the link itself can be used only once) and is cleared once the password is set or the
 * user signs out. A per-tab convenience only: Supabase decides what the session may do.
 */
const PASSWORD_SETUP_KEY = 'leaseguard.auth.passwordSetup'

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): KeyValueStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function readPasswordSetup(storage: KeyValueStorage | null = tabStorage()): PasswordSetupKind | null {
  try {
    const value = storage?.getItem(PASSWORD_SETUP_KEY)
    return value === 'invite' || value === 'recovery' ? value : null
  } catch {
    return null
  }
}

export function markPasswordSetup(kind: PasswordSetupKind, storage: KeyValueStorage | null = tabStorage()): void {
  try {
    storage?.setItem(PASSWORD_SETUP_KEY, kind)
  } catch {
    // Storage blocked: the password step is offered only until the page is reloaded.
  }
}

export function clearPasswordSetup(storage: KeyValueStorage | null = tabStorage()): void {
  try {
    storage?.removeItem(PASSWORD_SETUP_KEY)
  } catch {
    // Nothing stored.
  }
}

// ------------------------------------------------------------------ captured at startup

let captured: AuthCallback | null = null

/**
 * Records the auth link in the current URL. Called once, right before the Supabase client is created
 * (which consumes the URL). An invitation or recovery session marks the password step as pending.
 */
export function captureAuthCallback(href: string, storage: KeyValueStorage | null = tabStorage()): AuthCallback | null {
  captured = parseAuthCallback(href)
  if (captured?.hasSession && (captured.type === 'invite' || captured.type === 'recovery')) markPasswordSetup(captured.type, storage)
  return captured
}

/** The auth link this page was opened with, if any. */
export function getAuthCallback(): AuthCallback | null {
  return captured
}
