import type { ReactNode } from 'react'

import { SupabaseAuthProvider } from './SupabaseAuthProvider'

/** The Supabase email/password session for the whole application. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
}
