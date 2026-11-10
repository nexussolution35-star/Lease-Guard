import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { createAppRouter } from '@/app/router/router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthContext, type AuthContextValue } from '@/features/auth/authContext'

import { signedInAuth } from './authFixtures'
import { createTestQueryClient } from './queryClient'

export interface RenderAppOptions {
  auth?: AuthContextValue
  queryClient?: QueryClient
}

/**
 * Render the real route tree at `path` with test providers, signed in unless `auth` says otherwise.
 * The test file fakes the API client (see `@/test/appApi`).
 */
export async function renderApp(path: string, { auth = signedInAuth(), queryClient = createTestQueryClient() }: RenderAppOptions = {}) {
  const router = createAppRouter({ queryClient, auth, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <TooltipProvider>
          <RouterProvider router={router} context={{ auth, queryClient }} />
        </TooltipProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
