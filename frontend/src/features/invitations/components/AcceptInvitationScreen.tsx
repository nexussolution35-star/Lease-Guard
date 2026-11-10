import { useNavigate } from '@tanstack/react-router'
import { Building2, KeyRound, LinkIcon, LogIn, LogOut, MailQuestion } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { AppLink, ErrorState, LoadingState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/authContext'
import { AuthPageFrame } from '@/features/auth/components/AuthPageFrame'
import { SetPasswordForm } from '@/features/auth/components/SetPasswordForm'
import { EMAIL_LINK_LIFETIME } from '@/features/auth/passwordReset'
import { ACCEPT_INVITATION_PATH, FORGOT_PASSWORD_PATH, loginHrefFor } from '@/features/auth/redirect'
import { labelFor } from '@/lib/labels'
import type { AuthCallback, PasswordSetupKind } from '@/services/api/authCallback'

import { useMyInvitations } from '../api/queries'
import { ReceivedInvitations } from './ReceivedInvitations'

const LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline'

export interface AcceptInvitationScreenProps {
  /** `?invitation=<id>` from the invitation email link. */
  invitationId: string | undefined
  /** The auth link this page was opened with (`getAuthCallback()`). */
  callback: AuthCallback | null
  /** Set while the session from an invitation link has not chosen a password yet. */
  passwordSetup: PasswordSetupKind | null
}

function acceptHref(invitationId: string | undefined): string {
  return invitationId ? `${ACCEPT_INVITATION_PATH}?invitation=${encodeURIComponent(invitationId)}` : ACCEPT_INVITATION_PATH
}

/**
 * Target of the invitation email. Supabase signs the invitee in from the link; a new user first chooses
 * a password, then sees the invitation (company, role, inviter) and accepts or declines it. Accepting
 * creates the membership and opens the company. Explains expired links, invitations that are not
 * available to the signed-in account, and the signed-out case.
 */
export function AcceptInvitationScreen({ invitationId, callback, passwordSetup }: AcceptInvitationScreenProps) {
  const { status, user } = useAuth()
  const [needsPassword, setNeedsPassword] = useState(passwordSetup !== null)

  if (status !== 'authenticated') {
    const signIn = (
      <Button asChild>
        <AppLink to={loginHrefFor(acceptHref(invitationId))}>
          <LogIn aria-hidden="true" />
          Sign in
        </AppLink>
      </Button>
    )
    if (callback?.error) {
      return (
        <AuthPageFrame
          icon={LinkIcon}
          title="This invitation link has expired or was already used"
          description={`Invitation links work once and expire after ${EMAIL_LINK_LIFETIME}. If you already chose a password, sign in to see your invitation. Otherwise ask your company administrator to send the invitation again.`}
          footer={
            <AppLink to={FORGOT_PASSWORD_PATH} className={LINK_CLASS}>
              Forgot your password?
            </AppLink>
          }
        >
          {signIn}
        </AuthPageFrame>
      )
    }
    return (
      <AuthPageFrame
        icon={Building2}
        title="Sign in to view your invitation"
        description="Sign in with the email address the invitation was sent to."
      >
        {signIn}
      </AuthPageFrame>
    )
  }

  if (needsPassword) {
    return (
      <AuthPageFrame
        icon={KeyRound}
        title="Set your password"
        description={`Welcome to LeaseGuard. Choose a password for ${user?.email ?? 'your account'}; you will use it to sign in.`}
      >
        <SetPasswordForm
          submitLabel="Set password and continue"
          onPasswordSet={() => {
            toast.success('Password set')
            setNeedsPassword(false)
          }}
        />
      </AuthPageFrame>
    )
  }

  return <InvitationDecision invitationId={invitationId} linkExpired={callback?.error != null} />
}

interface InvitationDecisionProps {
  invitationId: string | undefined
  linkExpired: boolean
}

function InvitationDecision({ invitationId, linkExpired }: InvitationDecisionProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const query = useMyInvitations()
  const email = user?.email ?? 'this account'

  const handleSignOut = () => {
    signOut().catch(() => toast.error('Could not sign out', { description: 'Try again in a moment.' }))
  }
  const signedInAs = (
    <>
      <span className="text-muted-foreground">Signed in as {email}.</span>
      <button type="button" className={LINK_CLASS} onClick={handleSignOut}>
        Sign out
      </button>
    </>
  )
  const leave = () => void navigate({ to: '/' })

  if (query.isPending) {
    return (
      <AuthPageFrame icon={Building2} title="Your invitation" footer={signedInAs}>
        <LoadingState label="Loading your invitation…" rows={2} />
      </AuthPageFrame>
    )
  }
  if (query.isError) {
    return (
      <AuthPageFrame icon={Building2} title="Your invitation" footer={signedInAs}>
        <ErrorState title="Your invitation could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
      </AuthPageFrame>
    )
  }

  const invitations = query.data
  const target = invitationId ? invitations.find((invitation) => invitation.id === invitationId) : undefined

  if (target) {
    return (
      <AuthPageFrame
        icon={Building2}
        title={`Join ${target.companyName}`}
        description={`${target.invitedByName ?? 'The LeaseGuard team'} invited you to join ${target.companyName} as ${labelFor(target.role).toLowerCase()}.`}
        footer={signedInAs}
      >
        <ReceivedInvitations invitations={[target]} onDeclined={leave} />
      </AuthPageFrame>
    )
  }

  const others = invitations.length > 0 ? <ReceivedInvitations invitations={invitations} /> : null
  if (invitationId) {
    return (
      <AuthPageFrame
        icon={MailQuestion}
        title="This invitation is not available"
        description={
          `You are signed in as ${email}. The invitation may have been accepted, declined or revoked${linkExpired ? ', the link may have expired' : ''}, ` +
          'or it was sent to a different email address. If it was sent to another address, sign out and open the link again.'
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleSignOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
          <Button asChild>
            <AppLink to="/">Go to dashboard</AppLink>
          </Button>
        </div>
        {others ? (
          <section aria-labelledby="other-invitations-title" className="flex flex-col gap-3">
            <h2 id="other-invitations-title" className="text-sm font-semibold">
              Your other invitations
            </h2>
            {others}
          </section>
        ) : null}
      </AuthPageFrame>
    )
  }

  return (
    <AuthPageFrame
      icon={Building2}
      title="Your invitations"
      description={invitations.length > 0 ? 'Accept an invitation to join that company.' : 'You have no pending invitations.'}
      footer={signedInAs}
    >
      {others ?? (
        <Button asChild>
          <AppLink to="/">Go to dashboard</AppLink>
        </Button>
      )}
    </AuthPageFrame>
  )
}
