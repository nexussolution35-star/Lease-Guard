import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { AcceptInvitationScreen } from '@/features/invitations/components/AcceptInvitationScreen'
import { getAuthCallback, readPasswordSetup, type PasswordSetupKind } from '@/services/api/authCallback'

/** `/auth/accept?invitation=<id>`: the link in the invitation email. */
const acceptSearchSchema = z.object({
  invitation: z.string().trim().min(1).max(100).optional().catch(undefined),
})

export const Route = createFileRoute('/auth/accept')({
  validateSearch: acceptSearchSchema,
  component: function AcceptInvitationRoute() {
    const { invitation } = Route.useSearch()
    // Read once: setting the password clears the marker while the screen moves on by itself. Only an
    // invitation link asks for a password here; a leftover password-link marker in this tab must not.
    const [passwordSetup] = useState<PasswordSetupKind | null>(() => (readPasswordSetup() === 'invite' ? 'invite' : null))
    return <AcceptInvitationScreen invitationId={invitation} callback={getAuthCallback()} passwordSetup={passwordSetup} />
  },
})
