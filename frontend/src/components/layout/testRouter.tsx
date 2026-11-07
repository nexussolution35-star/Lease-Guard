import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Render `ui` inside a tiny in-memory router at `path`. Every path renders `ui`, so links and
 * `useRouterState` work without the generated route tree.
 */
export async function renderWithRouter(ui: ReactNode, path = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <TooltipProvider>
        {ui}
        <Outlet />
      </TooltipProvider>
    ),
  })
  const splat = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null })
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, splat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const result = render(<RouterProvider router={router as never} />)
  return { ...result, router }
}
