import { createContext, useContext } from 'react'

import type { LoginValues } from './loginSchema'

/** `loading`: session not yet known. `authenticated` / `unauthenticated`: with or without a Supabase session. */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
}

export interface AuthContextValue extends AuthState {
  /** Rejects with an Error whose message is safe to show on the sign-in form. */
  signIn(credentials: LoginValues): Promise<void>
  signOut(): Promise<void>
  /**
   * Emails the signed-in user a password-change link (a Supabase recovery link to
   * `/auth/reset-password`) and resolves with the address it went to. Supabase only accepts a new
   * password from the recently authenticated session such a link creates (secure password change).
   * Rejects with a PasswordLinkError whose message is safe to show.
   */
  sendPasswordChangeLink(): Promise<string>
  /**
   * Sets a password without the current one, for the session an invitation, password-recovery or
   * password-change link created. Rejects with a PasswordChangeError whose message is safe to show.
   */
  setPassword(newPassword: string): Promise<void>
  /**
   * Asks Supabase to email a password-reset link to `email`. Resolves whether or not the address has an
   * account (no account enumeration); rejects with a PasswordResetError only when the request could
   * not be made at all.
   */
  requestPasswordReset(email: string): Promise<void>
}

/** Before the Supabase session is known. The app shows a loading screen meanwhile. */
export const PENDING_AUTH: AuthContextValue = {
  status: 'loading',
  user: null,
  signIn: () => Promise.reject(new Error('Authentication is still starting. Try again in a moment.')),
  signOut: () => Promise.resolve(),
  sendPasswordChangeLink: () => Promise.reject(new Error('Authentication is still starting. Try again in a moment.')),
  setPassword: () => Promise.reject(new Error('Authentication is still starting. Try again in a moment.')),
  requestPasswordReset: () => Promise.reject(new Error('Authentication is still starting. Try again in a moment.')),
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}
