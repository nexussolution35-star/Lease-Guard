import { Check, Loader2, X } from 'lucide-react'
import { useId } from 'react'

import { DateDisplay } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { labelFor } from '@/lib/labels'

import type { ReceivedInvitation } from '../api/source'

export interface ReceivedInvitationCardProps {
  invitation: ReceivedInvitation
  onAccept: () => void
  onDecline: () => void
  /** Which answer is being sent, if any; both buttons are disabled meanwhile. */
  pending?: 'accept' | 'decline' | null
  /** Disable the buttons (another invitation is being answered). */
  disabled?: boolean
}

/** One invitation to join a company: who invited, with which role, and Accept / Decline. A plain row; the list draws the dividers. */
export function ReceivedInvitationCard({ invitation, onAccept, onDecline, pending = null, disabled = false }: ReceivedInvitationCardProps) {
  const titleId = useId()
  const busy = disabled || pending !== null
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p id={titleId} className="truncate text-sm font-medium text-foreground">
          {invitation.companyName}
        </p>
        <p className="text-sm text-muted-foreground">
          Role: <span className="text-foreground">{labelFor(invitation.role)}</span> · Invited by {invitation.invitedByName ?? 'the LeaseGuard team'} ·{' '}
          <DateDisplay value={invitation.createdAt} />
        </p>
      </div>
      <div className="flex shrink-0 gap-2 self-end sm:self-auto">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDecline}>
          {pending === 'decline' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
          Decline
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={onAccept}>
          {pending === 'accept' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Accept
        </Button>
      </div>
    </article>
  )
}
