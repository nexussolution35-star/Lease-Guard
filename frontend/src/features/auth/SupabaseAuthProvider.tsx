import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { clearPasswordSetup } from '@/services/api/authCallback'
import { getSupabaseClient } from '@/services/api/supabase'

import { AuthContext, type AuthContextValue, type AuthState } from './authContext'
import { newPasswordErrorFrom, PasswordChangeError, PASSWORD_LINK_UNAVAILABLE, PasswordLinkError, passwordLinkErrorFrom } from './passwordChange'
import { isPasswordResetUnavailable, PASSWORD_RESET_UNAVAILABLE, PasswordResetError } from './passwordReset'
import { RESET_PASSWORD_PATH } from './redirect'
import { signInErrorFrom, SignInError } from './signInError'

function stateFrom(session: Session | null): AuthState {
  if (!session) return { status: 'unauthenticated', user: null }
  return { status: 'authenticated', user: { id: session.user.id, email: session.user.email ?? null } }
}

export interface SupabaseAuthProviderProps {
  children: ReactNode
  /** Injected in tests; defaults to the app's browser client. */
  client?: SupabaseClient
}

/** Supabase email/password session, kept in sync with Supabase's auth events. */
export function SupabaseAuthProvider({ children, client }: SupabaseAuthProviderProps) {
  const [supabase] = useState(() => client ?? getSupabaseClient())
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  useEffect(() => {
    // Fires INITIAL_SESSION first, then SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState(stateFrom(session)))
    return () => data.subscription.unsubscribe()
  }, [supabase])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      async signIn({ email, password }) {
        let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
        try {
          result = await supabase.auth.signInWithPassword({ email, password })
        } catch (cause) {
          throw new SignInError('Sign-in is unavailable right now. Try again shortly.', { cause })
        }
        if (result.error) throw signInErrorFrom(result.error)
      },
      async signOut() {
        clearPasswordSetup()
        // This browser only; other devices keep their sessions.
        await supabase.auth.signOut({ scope: 'local' })
      },
      async sendPasswordChangeLink() {
        const email = state.user?.email
        if (state.status !== 'authenticated' || !email) {
          throw new PasswordLinkError('Sign in again before changing your password.')
        }
        // The same recovery link as "Forgot password": opening it signs the user in afresh, which is what
        // Supabase's secure password change requires before `updateUser({ password })` is accepted.
        const redirectTo = new URL(RESET_PASSWORD_PATH, window.location.origin).toString()
        let result: Awaited<ReturnType<typeof supabase.auth.resetPasswordForEmail>>
        try {
          result = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        } catch (cause) {
          throw new PasswordLinkError(PASSWORD_LINK_UNAVAILABLE, null, { cause })
        }
        if (result.error) throw passwordLinkErrorFrom(result.error)
        return email
      },
      async setPassword(newPassword) {
        if (state.status !== 'authenticated') {
          throw new PasswordChangeError('Your link has expired. Request a new one and try again.')
        }
        let updated: Awaited<ReturnType<typeof supabase.auth.updateUser>>
        try {
          updated = await supabase.auth.updateUser({ password: newPassword })
        } catch (cause) {
          throw new PasswordChangeError('Your password could not be set right now. Try again shortly.', null, { cause })
        }
        if (updated.error) throw newPasswordErrorFrom(updated.error)
        clearPasswordSetup()
      },
      async requestPasswordReset(email) {
        const redirectTo = new URL(RESET_PASSWORD_PATH, window.location.origin).toString()
        let result: Awaited<ReturnType<typeof supabase.auth.resetPasswordForEmail>>
        try {
          result = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        } catch (cause) {
          throw new PasswordResetError(PASSWORD_RESET_UNAVAILABLE, { cause })
        }
        // Anything but an unavailable service is reported as sent: no account enumeration.
        if (result.error && isPasswordResetUnavailable(result.error)) {
          throw new PasswordResetError(PASSWORD_RESET_UNAVAILABLE, { cause: result.error })
        }
      },
    }),
    [state, supabase],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
