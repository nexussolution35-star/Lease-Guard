import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'

import { FormActions, TextField, zodResolver } from '@/components/forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'

import { useAuth } from '../authContext'
import { MIN_PASSWORD_LENGTH, PasswordChangeError, setPasswordSchema, type SetPasswordValues } from '../passwordChange'

export interface SetPasswordFormProps {
  /** Default `Set password`. */
  submitLabel?: string
  /** Called once the password is set. */
  onPasswordSet: () => void
}

const FALLBACK_ERROR = 'Your password could not be set right now. Try again shortly.'

/**
 * New password and confirmation, without the current password: for the session an invitation or
 * password-recovery link created (`supabase.auth.updateUser`).
 */
export function SetPasswordForm({ submitLabel = 'Set password', onPasswordSet }: SetPasswordFormProps) {
  const { setPassword } = useAuth()
  const form = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ newPassword }) => {
    try {
      await setPassword(newPassword)
      onPasswordSet()
    } catch (error) {
      if (error instanceof PasswordChangeError && error.field === 'newPassword') {
        form.setError('newPassword', { type: 'server', message: error.message }, { shouldFocus: true })
      } else {
        form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : FALLBACK_ERROR })
      }
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4" aria-label="Set your password">
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField
          control={form.control}
          name="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
        />
        <TextField control={form.control} name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required />
        <FormActions submitLabel={submitLabel} isSubmitting={form.formState.isSubmitting} className="sm:justify-stretch [&>div]:w-full [&_button]:w-full" />
      </form>
    </Form>
  )
}
