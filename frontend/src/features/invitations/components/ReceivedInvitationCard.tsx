import { Building2, Check, Loader2, X } from 'lucide-react'
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

/** One invitation to join a company: who invited, with which role, and Accept / Decline. */
export function ReceivedInvitationCard({ invitation, onAccept, onDecline, pending = null, disabled = false }: ReceivedInvitationCardProps) {
  const titleId = useId()
  const busy = disabled || pending !== null
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p id={titleId} className="truncate font-medium">
            {invitation.companyName}
          </p>
          <p className="text-sm text-muted-foreground">
            Role: <span className="text-foreground">{labelFor(invitation.role)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Invited by {invitation.invitedByName ?? 'the LeaseGuard team'} · <DateDisplay value={invitation.createdAt} />
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDecline}>
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
