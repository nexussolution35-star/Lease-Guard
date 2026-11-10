import { Outlet, useRouterState, type ErrorComponentProps } from '@tanstack/react-router'
import { MapPinOff } from 'lucide-react'

import { AppLayout } from '@/components/layout'
import { AppLink, EmptyState, ErrorState, LoadingState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { WorkspaceGate } from '@/features/account/components/WorkspaceGate'
import { PendingInvitationsBanner } from '@/features/invitations/components/PendingInvitationsBanner'

/** Routes rendered without the application shell (full-page screens that work signed out). */
const BARE_ROUTE_IDS: ReadonlySet<string> = new Set(['/login', '/auth/accept', '/auth/forgot-password', '/auth/reset-password'])

/**
 * Root route layout: every screen renders inside the application shell, except bare routes such as
 * /login and the auth link pages. The signed-in user's workspace (`GET /me`) is opened before the shell
 * renders; open invitations to other companies are shown above every screen.
 */
export function RootLayout() {
  const bare = useRouterState({ select: (s) => s.matches.some((m) => BARE_ROUTE_IDS.has(m.routeId)) })
  if (bare) return <Outlet />
  return (
    <WorkspaceGate>
      <AppLayout>
        <PendingInvitationsBanner />
        <Outlet />
      </AppLayout>
    </WorkspaceGate>
  )
}

/** Shown inside the shell for unknown URLs. */
export function NotFoundScreen() {
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
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Default pending state for a route, rendered inside the shell. */
export function RoutePendingScreen() {
  return <LoadingState label="Loading screen…" rows={4} />
}

/** Default error state for a route: rendered inside the shell, so navigation keeps working. */
export function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  return <ErrorState title="This screen failed to load" error={toError(error)} onRetry={reset} />
}

/** Rendered without the shell so a failure inside the layout itself cannot loop. */
export function RootErrorScreen({ error, reset }: ErrorComponentProps) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <ErrorState title="This screen failed to load" error={toError(error)} onRetry={reset} />
    </div>
  )
}
