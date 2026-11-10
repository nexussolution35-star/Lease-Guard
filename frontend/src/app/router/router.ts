import type { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { NotFoundScreen, RouteErrorScreen, RoutePendingScreen } from '@/app/layouts/RootLayout'
import { PENDING_AUTH, type AuthContextValue } from '@/features/auth/authContext'
import { queryClient } from '@/services/api/queryClient'

import { routeTree } from './routeTree.gen'

export interface AppRouterOptions {
  queryClient: QueryClient
  auth: AuthContextValue
  /** Memory history in tests; browser history by default. */
  history?: RouterHistory
}

/**
 * Screens render their own pending / error / not-found states inside the shell; only a failure of the
 * root layout itself replaces the whole page (see __root.tsx).
 */
export function createAppRouter({ queryClient: client, auth, history }: AppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient: client, auth },
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    // TanStack Query owns data freshness; the router should not cache preloads on top of it.
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RoutePendingScreen,
    defaultErrorComponent: RouteErrorScreen,
    defaultNotFoundComponent: NotFoundScreen,
  })
}

/** The application router. AppRouter replaces `context.auth` with the live session on every render. */
export const router = createAppRouter({ queryClient, auth: PENDING_AUTH })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
