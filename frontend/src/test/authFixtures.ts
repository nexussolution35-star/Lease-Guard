import { vi } from 'vitest'

import type { AuthContextValue } from '@/features/auth/authContext'

import { TEST_USER_ID } from './accountFixtures'

type SendPasswordChangeLink = AuthContextValue['sendPasswordChangeLink']
type SetPassword = AuthContextValue['setPassword']
type RequestPasswordReset = AuthContextValue['requestPasswordReset']

export type TestAuth = AuthContextValue & {
  signOut: ReturnType<typeof vi.fn<() => Promise<void>>>
  sendPasswordChangeLink: ReturnType<typeof vi.fn<SendPasswordChangeLink>>
  setPassword: ReturnType<typeof vi.fn<SetPassword>>
  requestPasswordReset: ReturnType<typeof vi.fn<RequestPasswordReset>>
}

/** A signed-in auth value for component tests. */
export function signedInAuth(): TestAuth {
  return {
    status: 'authenticated',
    user: { id: TEST_USER_ID, email: 'sipho.dlamini@nexussolution.co.za' },
    signIn: () => Promise.resolve(),
    signOut: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    sendPasswordChangeLink: vi.fn<SendPasswordChangeLink>(() => Promise.resolve('sipho.dlamini@nexussolution.co.za')),
    setPassword: vi.fn<SetPassword>(() => Promise.resolve()),
    requestPasswordReset: vi.fn<RequestPasswordReset>(() => Promise.resolve()),
  }
}

/** A signed-out auth value (no Supabase session). */
export function signedOutAuth(): TestAuth {
  return { ...signedInAuth(), status: 'unauthenticated', user: null }
}
