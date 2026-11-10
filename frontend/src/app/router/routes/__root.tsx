import { createRootRouteWithContext, redirect } from '@tanstack/react-router'

import { NotFoundScreen, RootErrorScreen, RootLayout } from '@/app/layouts/RootLayout'
import type { RouterContext } from '@/app/router/routerContext'
import { loginRedirectFor } from '@/features/auth/guard'

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every route except /login requires a Supabase session.
  beforeLoad: ({ context, location }) => {
    const target = loginRedirectFor(context.auth, location)
    if (target) throw redirect({ to: target.to, search: target.search, replace: true })
  },
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
  errorComponent: RootErrorScreen,
})
