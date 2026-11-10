import { useNavigate } from '@tanstack/react-router'
import { KeyRound, LinkIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLink } from '@/components/shared'
import { Button } from '@/components/ui/button'
import type { AuthCallback, PasswordSetupKind } from '@/services/api/authCallback'

import { useAuth } from '../authContext'
import { EMAIL_LINK_LIFETIME } from '../passwordReset'
import { FORGOT_PASSWORD_PATH, LOGIN_PATH } from '../redirect'
import { AuthPageFrame } from './AuthPageFrame'
import { SetPasswordForm } from './SetPasswordForm'

const LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline'

export interface ResetPasswordScreenProps {
  /** The auth link this page was opened with (`getAuthCallback()`). */
  callback: AuthCallback | null
  /** Set while the session from a recovery (or invitation) link has not chosen a password yet. */
  passwordSetup: PasswordSetupKind | null
}

/**
 * Target of the password links: "Forgot password" (signed out) and "Change password" in the account
 * menu (signed in) both send a Supabase recovery link here. Supabase signs the user in afresh from the
 * link, which is what its secure password change requires, the user sets a new password and continues
 * into the app. An expired or reused link explains how to get a new one.
 */
export function ResetPasswordScreen({ callback, passwordSetup }: ResetPasswordScreenProps) {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const signedIn = status === 'authenticated'

  if (callback?.error || !signedIn) {
    // Signed in already (e.g. a password-change link that expired): a new link comes from the account
    // menu, since "Forgot password" is only for signed-out users.
    return (
      <AuthPageFrame
        icon={LinkIcon}
        title="This password link is invalid or has expired"
        description={
          signedIn
            ? `Password links work once and expire after ${EMAIL_LINK_LIFETIME}. To get a new one, open the account menu and choose Change password.`
            : `Password links work once and expire after ${EMAIL_LINK_LIFETIME}. Request a new link to choose a password.`
        }
        footer={
          signedIn ? null : (
            <AppLink to={LOGIN_PATH} className={LINK_CLASS}>
              Back to sign in
            </AppLink>
          )
        }
      >
        {signedIn ? (
          <Button asChild>
            <AppLink to="/">Go to dashboard</AppLink>
          </Button>
        ) : (
          <Button asChild>
            <AppLink to={FORGOT_PASSWORD_PATH}>Request a new link</AppLink>
          </Button>
        )}
      </AuthPageFrame>
    )
  }

  if (passwordSetup === null) {
    return (
      <AuthPageFrame
        icon={KeyRound}
        title="This password link was already used"
        description={`You are signed in${user?.email ? ` as ${user.email}` : ''}. To change your password, open the account menu and choose Change password.`}
      >
        <Button asChild>
          <AppLink to="/">Go to dashboard</AppLink>
        </Button>
      </AuthPageFrame>
    )
  }

  return (
    <AuthPageFrame
      icon={KeyRound}
      title="Set a new password"
      description={user?.email ? `Choose a new password for ${user.email}.` : 'Choose a new password for your account.'}
    >
      <SetPasswordForm
        submitLabel="Save new password"
        onPasswordSet={() => {
          toast.success('Password updated', { description: 'You are signed in with your new password.' })
          void navigate({ to: '/', replace: true })
        }}
      />
    </AuthPageFrame>
  )
}
