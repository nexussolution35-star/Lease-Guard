import type { QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { LoadingState } from '@/components/shared'
import { useAuth, type AuthStatus } from '@/features/auth/authContext'
import { useAppStore } from '@/store/appStore'

import type { router as appRouter } from './router'

export interface AppRouterProps {
  router: typeof appRouter
  queryClient: QueryClient
}

/**
 * Mounts the router with the live auth state as router context. When the session changes, route
 * guards re-run (sign-out lands on /login, sign-in leaves it) and cached data of the previous user is
 * dropped.
 */
export function AppRouter({ router, queryClient }: AppRouterProps) {
  const auth = useAuth()
  const previous = useRef<AuthStatus>(auth.status)

  useEffect(() => {
    const before = previous.current
    if (before === auth.status) return
    previous.current = auth.status
    if (before === 'authenticated') {
      queryClient.clear()
      // Forget the workspace chosen for the previous session.
      useAppStore.getState().setActiveCompany('')
    }
    // The first resolution of the session is handled by the router's initial load.
    if (before !== 'loading') void router.invalidate()
  }, [auth.status, router, queryClient])

  if (auth.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-md p-6">
        <LoadingState label="Checking your session…" rows={2} />
      </div>
    )
  }
  return <RouterProvider router={router} context={{ auth, queryClient }} />
}
