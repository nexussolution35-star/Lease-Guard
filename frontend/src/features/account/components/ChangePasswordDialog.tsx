import { AlertCircle, MailCheck } from 'lucide-react'
import { useState } from 'react'

import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/features/auth/authContext'
import { PASSWORD_LINK_COOLDOWN_SECONDS, PASSWORD_LINK_UNAVAILABLE, PasswordLinkError } from '@/features/auth/passwordChange'
import { EMAIL_LINK_LIFETIME } from '@/features/auth/passwordReset'

import { useCooldown } from '../useCooldown'

export interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Changes the signed-in user's password by email link. Supabase Auth's secure password change only
 * accepts a new password from a recently authenticated session, so this dialog never asks for a
 * password: it emails a link that opens `/auth/reset-password`, where the new password is chosen.
 * Stays mounted while closed, so the resend cooldown survives closing and reopening the dialog.
 */
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { user, sendPasswordChangeLink } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const cooldown = useCooldown()
  const email = sentTo ?? user?.email ?? null

  async function send() {
    setIsSending(true)
    setError(null)
    try {
      const address = await sendPasswordChangeLink()
      setSentTo(address)
      cooldown.start(PASSWORD_LINK_COOLDOWN_SECONDS)
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : PASSWORD_LINK_UNAVAILABLE)
      if (cause instanceof PasswordLinkError && cause.retryAfterSeconds !== null) cooldown.start(cause.retryAfterSeconds)
    } finally {
      setIsSending(false)
    }
  }

  const waiting = cooldown.secondsLeft > 0
  const action = sentTo ? 'Resend link' : 'Send link'
  const submitLabel = waiting ? `${action} in ${cooldown.secondsLeft}s` : action

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
      title="Change password"
      description="For your security, you set a new password from a link we email to you."
      submitLabel={submitLabel}
      submitDisabled={waiting}
      cancelLabel={sentTo ? 'Done' : 'Cancel'}
      size="sm"
      onSubmit={send}
      isPending={isSending}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {sentTo ? (
        <Alert role="status">
          <MailCheck aria-hidden="true" />
          <AlertTitle>We sent a link to {sentTo}</AlertTitle>
          <AlertDescription>
            Open the link in that email to set a new password. It works once and expires after {EMAIL_LINK_LIFETIME}. If it
            has not arrived in a few minutes, check your spam folder or resend it.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          We will email a secure link to <span className="font-medium text-foreground">{email ?? 'your email address'}</span>.
          Open it to choose a new password; you stay signed in until then.
        </p>
      )}
    </FormDialog>
  )
}
