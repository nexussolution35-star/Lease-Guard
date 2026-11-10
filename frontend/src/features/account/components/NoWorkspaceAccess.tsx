import { LogOut, ShieldOff } from 'lucide-react'

import { EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'

export interface NoWorkspaceAccessProps {
  email: string | null
  /** `no-profile`: signed in to Supabase but unknown to LeaseGuard. `no-memberships`: no company access. */
  reason: 'no-profile' | 'no-memberships'
  onSignOut: () => void
}

/** The signed-in account cannot open any company workspace. */
export function NoWorkspaceAccess({ email, reason, onSignOut }: NoWorkspaceAccessProps) {
  const who = email ?? 'This account'
  const description =
    reason === 'no-profile'
      ? `${who} is signed in, but has no LeaseGuard user profile. Ask your company administrator to invite you.`
      : `${who} is not an active member of any company workspace. Ask your company administrator for access, or sign in with another account.`
  return (
    <EmptyState
      icon={ShieldOff}
      title="No workspace access"
      description={description}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      }
    />
  )
}
