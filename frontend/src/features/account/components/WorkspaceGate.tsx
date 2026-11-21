import { isApiError } from '@leaseguard/api-client'
import { LogOut } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'

import { BrandMark, ErrorState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/authContext'
import { NoWorkspaceYet } from '@/features/invitations/components/NoWorkspaceYet'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { useAppStore } from '@/store/appStore'

import { useCurrentUserProfile } from '../api/queries'
import { readRememberedWorkspace, rememberWorkspace } from '../rememberedWorkspace'
import { resolveWorkspace } from '../workspace'
import { NoWorkspaceAccess } from './NoWorkspaceAccess'

/** The interstitial before the shell: the brand, as on the signed-out pages, then the state. */
function GateFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 bg-background px-4 pt-[20vh] pb-10 text-foreground">
      <p>
        <BrandMark />
      </p>
      {children}
    </main>
  )
}

function GateStatus({ children }: { children: string }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {children}
    </p>
  )
}

export interface WorkspaceGateProps {
  children: ReactNode
}

/**
 * Loads the signed-in user (`GET /api/v1/me`) and opens a workspace before the application
 * shell renders. Keeps a still-valid selected or remembered workspace, otherwise the default
 * membership. Without memberships it shows "No workspace yet" with the user's pending invitations
 * (accepting one opens that company); without a LeaseGuard profile a "no access" screen. Shows an error
 * with retry when `/me` fails, and signs out on 401 (the expired session then lands on /login).
 */
export function WorkspaceGate({ children }: WorkspaceGateProps) {
  const { user, signOut } = useAuth()
  const query = useCurrentUserProfile()
  const activeCompanyId = useActiveCompanyId()
  const profile = query.data

  const resolution = profile ? resolveWorkspace(profile.memberships, activeCompanyId, readRememberedWorkspace(profile.id)) : null
  const target = resolution?.status === 'ready' ? resolution.companyId : null
  const unauthorized = isApiError(query.error) && query.error.isUnauthorized

  useEffect(() => {
    if (!profile) return
    if (target) {
      if (target !== activeCompanyId) useAppStore.getState().setActiveCompany(target)
      rememberWorkspace(profile.id, target)
    } else if (activeCompanyId !== null) {
      // Membership removed since the workspace was opened: stop sending its company id.
      useAppStore.getState().setActiveCompany('')
    }
  }, [profile, target, activeCompanyId])

  useEffect(() => {
    if (unauthorized) void signOut().catch(() => undefined)
  }, [unauthorized, signOut])

  const handleSignOut = () => {
    signOut().catch(() => toast.error('Could not sign out', { description: 'Try again in a moment.' }))
  }

  if (unauthorized) {
    return (
      <GateFrame>
        <GateStatus>Your session has ended. Signing you out…</GateStatus>
      </GateFrame>
    )
  }

  if (profile === undefined) {
    if (query.isError) {
      return (
        <GateFrame>
          <ErrorState title="Your account could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
          <Button type="button" variant="ghost" size="sm" className="self-end" onClick={handleSignOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </GateFrame>
      )
    }
    return (
      <GateFrame>
        <GateStatus>Loading your workspaces…</GateStatus>
      </GateFrame>
    )
  }

  if (profile === null) {
    return (
      <GateFrame>
        <NoWorkspaceAccess email={user?.email ?? null} reason="no-profile" onSignOut={handleSignOut} />
      </GateFrame>
    )
  }

  if (resolution?.status === 'no-access') {
    return (
      <GateFrame>
        <NoWorkspaceYet email={profile.email} onSignOut={handleSignOut} />
      </GateFrame>
    )
  }

  if (target !== activeCompanyId) {
    return (
      <GateFrame>
        <GateStatus>Opening your workspace…</GateStatus>
      </GateFrame>
    )
  }

  return <>{children}</>
}
