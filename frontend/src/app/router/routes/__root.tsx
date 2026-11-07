import { createRootRoute } from '@tanstack/react-router'

import { NotFoundScreen, RootErrorScreen, RootLayout } from '@/app/layouts/RootLayout'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
  errorComponent: RootErrorScreen,
})
