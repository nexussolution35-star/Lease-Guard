import { createRootRoute, Outlet } from '@tanstack/react-router'
import { MapPinOff } from 'lucide-react'

import { AppLayout } from '@/components/layout'
import { AppLink, EmptyState, ErrorState } from '@/components/shared'
import { Button } from '@/components/ui/button'

export const Route = createRootRoute({
  component: function RootLayout() {
    return (
      <AppLayout>
        <Outlet />
      </AppLayout>
    )
  },
  notFoundComponent: function NotFoundScreen() {
    return (
      <EmptyState
        icon={MapPinOff}
        title="Page not found"
        description="The page you were looking for does not exist."
        action={
          <Button asChild variant="outline" size="sm">
            <AppLink to="/">Go to dashboard</AppLink>
          </Button>
        }
      />
    )
  },
  // Rendered without the shell so a failure inside the layout itself cannot loop.
  errorComponent: function RootError({ error, reset }) {
    const normalised = error instanceof Error ? error : new Error(String(error))
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorState title="This screen failed to load" error={normalised} onRetry={reset} />
      </div>
    )
  },
})
