import type { SupabaseClient } from '@supabase/supabase-js'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useAuth, type AuthContextValue } from './authContext'
import { PasswordLinkError } from './passwordChange'
import { SupabaseAuthProvider } from './SupabaseAuthProvider'

type Result = { data: unknown; error: (Error & { status?: number; code?: string }) | null }

const EMAIL = 'ayanda.nkosi@example.test'
const session = { access_token: 'token', user: { id: 'user-1', email: EMAIL } }

/** The part of the Supabase auth client the provider uses. */
function fakeSupabase(results: { signIn?: Result; update?: Result; recover?: Result } = {}) {
  const auth = {
    onAuthStateChange: vi.fn((callback: (event: string, value: unknown) => void) => {
      callback('INITIAL_SESSION', session)
      return { data: { subscription: { unsubscribe: () => undefined } } }
    }),
    signInWithPassword: vi.fn(async () => results.signIn ?? { data: { session }, error: null }),
    updateUser: vi.fn(async () => results.update ?? { data: { user: session.user }, error: null }),
    resetPasswordForEmail: vi.fn(async (_email: string, _options: { redirectTo: string }) => results.recover ?? { data: {}, error: null }),
    signOut: vi.fn(async () => ({ error: null })),
  }
  return { client: { auth } as unknown as SupabaseClient, auth }
}

async function renderProvider(client: SupabaseClient): Promise<() => AuthContextValue> {
  let current: AuthContextValue | null = null
  function Probe() {
    current = useAuth()
    return null
  }
  render(
    <SupabaseAuthProvider client={client}>
      <Probe />
    </SupabaseAuthProvider>,
  )
  await waitFor(() => expect(current?.status).toBe('authenticated'))
  return () => {
    if (!current) throw new Error('auth not rendered')
    return current
  }
}

function authError(status: number, code: string) {
  return Object.assign(new Error('raw provider message'), { status, code })
}

describe('SupabaseAuthProvider sendPasswordChangeLink', () => {
  it('emails a password link for the signed-in address to /auth/reset-password, without touching the password', async () => {
    const { client, auth } = fakeSupabase()
    const current = await renderProvider(client)
    let sentTo: string | undefined
    await act(async () => {
      sentTo = await current().sendPasswordChangeLink()
    })
    expect(sentTo).toBe(EMAIL)
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, { redirectTo: `${window.location.origin}/auth/reset-password` })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('reports rate limits with the wait Supabase gives', async () => {
    const limited = Object.assign(new Error('For security purposes, you can only request this after 37 seconds.'), {
      status: 429,
      code: 'over_email_send_rate_limit',
    })
    const { client } = fakeSupabase({ recover: { data: null, error: limited } })
    const current = await renderProvider(client)
    const error = await current()
      .sendPasswordChangeLink()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PasswordLinkError)
    expect((error as PasswordLinkError).retryAfterSeconds).toBe(37)
  })

  it('explains when Supabase cannot be reached', async () => {
    const { client, auth } = fakeSupabase()
    auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const current = await renderProvider(client)
    await expect(current().sendPasswordChangeLink()).rejects.toThrow('The link could not be sent right now. Try again shortly.')
  })
})

describe('SupabaseAuthProvider setPassword', () => {
  it('sets the new password for the session the link created', async () => {
    const { client, auth } = fakeSupabase()
    const current = await renderProvider(client)
    await act(() => current().setPassword('new-password-1'))
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' })
  })

  it('explains when Supabase refuses the new password', async () => {
    const { client } = fakeSupabase({ update: { data: { user: null }, error: authError(422, 'same_password') } })
    const current = await renderProvider(client)
    await expect(current().setPassword('old-password-2')).rejects.toThrow('Choose a password different from your current one.')
  })

  it('asks for a new link when Supabase requires a recent sign-in', async () => {
    const { client } = fakeSupabase({ update: { data: { user: null }, error: authError(400, 'reauthentication_needed') } })
    const current = await renderProvider(client)
    await expect(current().setPassword('new-password-1')).rejects.toThrow(/Request a new password link/)
  })
})
