import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'

import { FormActions, TextField, zodResolver } from '@/components/forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'

import { loginSchema, type LoginFormValues, type LoginValues } from '../loginSchema'

export interface LoginFormProps {
  /** Rejects with an Error whose message is shown above the form. */
  onSubmit: (values: LoginValues) => Promise<void>
}

const FALLBACK_ERROR = 'Sign-in failed. Try again.'

export function LoginForm({ onSubmit }: LoginFormProps) {
  const form = useForm<LoginFormValues, unknown, LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values)
    } catch (error) {
      form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : FALLBACK_ERROR })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4" aria-label="Sign in">
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField control={form.control} name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
        <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" required />
        <FormActions submitLabel="Sign in" isSubmitting={form.formState.isSubmitting} className="sm:justify-stretch [&>div]:w-full [&_button]:w-full" />
      </form>
    </Form>
  )
}
