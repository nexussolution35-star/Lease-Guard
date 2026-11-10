import { AppProviders } from '@/app/providers/AppProviders'
import { AppRouter } from '@/app/router/AppRouter'
import { router } from '@/app/router/router'
import { queryClient } from '@/services/api/queryClient'

/** The configured application. Loaded by main.tsx only after the environment validated. */
export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <AppRouter router={router} queryClient={queryClient} />
    </AppProviders>
  )
}
