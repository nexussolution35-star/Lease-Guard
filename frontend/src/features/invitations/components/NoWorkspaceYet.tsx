import { Building2, LogOut } from 'lucide-react'

import { EmptyState, ErrorState, LoadingState } from '@/components/shared'
import { Button } from '@/components/ui/button'

import { useMyInvitations } from '../api/queries'
import { ReceivedInvitations } from './ReceivedInvitations'

export interface NoWorkspaceYetProps {
  email: string | null
  onSignOut: () => void
}

/**
 * The signed-in user belongs to no company yet: their open invitations, to accept one, or what to do
 * when there are none.
 */
export function NoWorkspaceYet({ email, onSignOut }: NoWorkspaceYetProps) {
  const query = useMyInvitations()
  const invitations = query.data ?? []
  const who = email ?? 'This account'
  const hasInvitations = invitations.length > 0
  const description = hasInvitations
    ? `${who} is not a member of any company workspace yet. Accept an invitation to get started.`
    : `${who} is not a member of any company workspace yet. Ask your company administrator to invite you, or sign in with another account.`

  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        icon={Building2}
        title="No workspace yet"
        description={query.isPending ? `${who} is not a member of any company workspace yet.` : description}
        action={
          <Button type="button" variant="outline" size="sm" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        }
      />
      {query.isPending ? <LoadingState label="Loading your invitations…" rows={2} /> : null}
      {query.isError ? (
        <ErrorState title="Your invitations could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      {hasInvitations ? (
        <section aria-labelledby="no-workspace-invitations-title" className="flex flex-col gap-3">
          <h2 id="no-workspace-invitations-title" className="font-semibold tracking-tight">
            Your invitations
          </h2>
          <ReceivedInvitations invitations={invitations} />
        </section>
      ) : null}
    </div>
  )
}
