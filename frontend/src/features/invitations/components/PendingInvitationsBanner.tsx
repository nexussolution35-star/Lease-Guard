import { useMyInvitations } from '../api/queries'
import { ReceivedInvitations } from './ReceivedInvitations'

/**
 * Shown at the top of every screen while the signed-in user has open invitations, including
 * invitations to further companies for users who already have a workspace. Loading and failures stay
 * silent: the invitations also appear on the invitation page and the "No workspace yet" screen.
 */
export function PendingInvitationsBanner() {
  const { data: invitations = [] } = useMyInvitations()
  if (invitations.length === 0) return null
  const count = invitations.length
  return (
    <section aria-labelledby="pending-invitations-title" className="mb-6 flex flex-col gap-3 rounded-md border border-border px-4 py-3">
      <div className="space-y-0.5">
        <h2 id="pending-invitations-title" className="flex items-center gap-2 text-sm font-medium text-balance text-foreground">
          {/* Waiting on this user: the amber status dot. */}
          <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          {count === 1 ? 'You have a pending invitation' : `You have ${count} pending invitations`}
        </h2>
        <p className="text-sm text-muted-foreground">Accept an invitation to add that company to your workspaces.</p>
      </div>
      <ReceivedInvitations invitations={invitations} />
    </section>
  )
}
