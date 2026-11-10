import type { AuthState } from './authContext'
import { LOGIN_PATH, PUBLIC_PATHS } from './redirect'

export interface GuardLocation {
  pathname: string
  /** Path plus search and hash, e.g. `/properties?page=2`. */
  href: string
}

export interface LoginRedirect {
  to: typeof LOGIN_PATH
  search: { redirect?: string }
}

/**
 * Root route guard: every route except the public ones (/login and the auth link pages) needs a
 * session; the user returns to the requested page after signing in.
 */
export function loginRedirectFor(auth: Pick<AuthState, 'status'>, location: GuardLocation): LoginRedirect | null {
  if (auth.status === 'authenticated') return null
  if (PUBLIC_PATHS.has(location.pathname)) return null
  return { to: LOGIN_PATH, search: location.href === '/' ? {} : { redirect: location.href } }
}
