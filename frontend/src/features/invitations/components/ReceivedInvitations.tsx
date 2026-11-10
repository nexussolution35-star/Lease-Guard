import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmationDialog } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useAcceptInvitation, useDeclineInvitation } from '../api/queries'
import type { ReceivedInvitation } from '../api/source'
import { invitationAnswerError } from './invitationErrors'
import { ReceivedInvitationCard } from './ReceivedInvitationCard'

export interface ReceivedInvitationsProps {
  invitations: readonly ReceivedInvitation[]
  /** Called after a decline (e.g. to leave the invitation page). */
  onDeclined?: (invitation: ReceivedInvitation) => void
}

/**
 * The signed-in user's invitations with Accept / Decline. Accepting joins the company, opens it as the
 * active workspace and goes to its dashboard; declining asks for confirmation first.
 */
export function ReceivedInvitations({ invitations, onDeclined }: ReceivedInvitationsProps) {
  const navigate = useNavigate()
  const accept = useAcceptInvitation()
  const decline = useDeclineInvitation()
  const [declining, setDeclining] = useState<ReceivedInvitation | null>(null)
  const [answering, setAnswering] = useState<{ id: string; action: 'accept' | 'decline' } | null>(null)

  async function handleAccept(invitation: ReceivedInvitation) {
    setAnswering({ id: invitation.id, action: 'accept' })
    try {
      await accept.mutateAsync(invitation.id)
      toast.success(`You joined ${invitation.companyName}`, { description: `Your role: ${labelFor(invitation.role)}.` })
      await navigate({ to: '/' })
    } catch (error) {
      const copy = invitationAnswerError('accept', error)
      toast.error(copy.title, { description: copy.description })
    } finally {
      setAnswering(null)
    }
  }

  async function handleDecline(invitation: ReceivedInvitation) {
    setAnswering({ id: invitation.id, action: 'decline' })
    try {
      await decline.mutateAsync(invitation.id)
      toast.success('Invitation declined', { description: `You did not join ${invitation.companyName}.` })
      onDeclined?.(invitation)
    } catch (error) {
      const copy = invitationAnswerError('decline', error)
      toast.error(copy.title, { description: copy.description })
    } finally {
      setAnswering(null)
    }
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {invitations.map((invitation) => (
          <li key={invitation.id}>
            <ReceivedInvitationCard
              invitation={invitation}
              pending={answering?.id === invitation.id ? answering.action : null}
              disabled={answering !== null && answering.id !== invitation.id}
              onAccept={() => void handleAccept(invitation)}
              onDecline={() => setDeclining(invitation)}
            />
          </li>
        ))}
      </ul>
      <ConfirmationDialog
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) setDeclining(null)
        }}
        title={declining ? `Decline the invitation to ${declining.companyName}?` : 'Decline the invitation?'}
        description="You will not join this company. Its administrator can invite you again later."
        confirmLabel="Decline invitation"
        destructive
        onConfirm={async () => {
          if (declining) await handleDecline(declining)
        }}
      />
    </>
  )
}
