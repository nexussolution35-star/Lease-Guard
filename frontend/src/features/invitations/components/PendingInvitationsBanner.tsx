import { MailPlus } from 'lucide-react'

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
    <section aria-labelledby="pending-invitations-title" className="mb-6 flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <MailPlus className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-0.5">
          <h2 id="pending-invitations-title" className="font-semibold tracking-tight">
            {count === 1 ? 'You have a pending invitation' : `You have ${count} pending invitations`}
          </h2>
          <p className="text-sm text-muted-foreground">Accept an invitation to add that company to your workspaces.</p>
        </div>
      </div>
      <ReceivedInvitations invitations={invitations} />
    </section>
  )
}
