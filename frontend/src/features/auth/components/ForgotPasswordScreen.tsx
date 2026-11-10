import { AlertCircle, KeyRound, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { FormActions, TextField, zodResolver } from '@/components/forms'
import { AppLink } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'

import { useAuth } from '../authContext'
import { EMAIL_LINK_LIFETIME, forgotPasswordSchema, PASSWORD_RESET_UNAVAILABLE, type ForgotPasswordFormValues, type ForgotPasswordValues } from '../passwordReset'
import { LOGIN_PATH } from '../redirect'
import { AuthPageFrame } from './AuthPageFrame'

const LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline'

/**
 * Requests a password-reset email. Whatever the address, the same confirmation is shown afterwards, so
 * the page never reveals whether an account exists.
 */
export function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useForm<ForgotPasswordFormValues, unknown, ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })
  const rootError = form.formState.errors.root?.message
  const backToSignIn = (
    <AppLink to={LOGIN_PATH} className={LINK_CLASS}>
      Back to sign in
    </AppLink>
  )

  const submit = form.handleSubmit(async ({ email }) => {
    try {
      await requestPasswordReset(email)
      setSentTo(email)
    } catch (error) {
      form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : PASSWORD_RESET_UNAVAILABLE })
    }
  })

  if (sentTo !== null) {
    return (
      <AuthPageFrame
        icon={MailCheck}
        title="Check your email"
        description={`If an account exists for ${sentTo}, we have emailed it a link to choose a new password. The link works once and expires after ${EMAIL_LINK_LIFETIME}.`}
        footer={backToSignIn}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset({ email: '' })
            setSentTo(null)
          }}
        >
          Use a different email address
        </Button>
      </AuthPageFrame>
    )
  }

  return (
    <AuthPageFrame
      icon={KeyRound}
      title="Reset your password"
      description="Enter the email address you sign in with. We will email you a link to choose a new password."
      footer={backToSignIn}
    >
      <Form {...form}>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4" aria-label="Reset your password">
          {rootError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField control={form.control} name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
          <FormActions
            submitLabel="Send reset link"
            isSubmitting={form.formState.isSubmitting}
            className="sm:justify-stretch [&>div]:w-full [&_button]:w-full"
          />
        </form>
      </Form>
    </AuthPageFrame>
  )
}
