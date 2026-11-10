export const LOGIN_PATH = '/login'
export const FORGOT_PASSWORD_PATH = '/auth/forgot-password'
export const RESET_PASSWORD_PATH = '/auth/reset-password'
export const ACCEPT_INVITATION_PATH = '/auth/accept'

/** Pages that open without a session: sign-in and the targets of Supabase Auth email links. */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH, ACCEPT_INVITATION_PATH])

/** Never a destination after signing in. */
const NO_RETURN_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH])

/**
 * Where to go after signing in. Only same-app paths are allowed (no `//host` or absolute URLs, which
 * would be an open redirect), and never back to the login or password pages.
 */
export function safeRedirectTarget(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  const pathname = value.split(/[?#]/)[0] ?? '/'
  for (const path of NO_RETURN_PATHS) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return '/'
  }
  return value
}

/** `/login?redirect=…` for returning to `target` after signing in. */
export function loginHrefFor(target: string): string {
  return target === '/' ? LOGIN_PATH : `${LOGIN_PATH}?redirect=${encodeURIComponent(target)}`
}
