import { z } from 'zod'

/**
 * How long an emailed link (invitation, password link) works. Must match `otp_expiry` in
 * supabase/config.toml (180 s) and `mailer_otp_exp` set by `pnpm auth:configure:remote`.
 */
export const EMAIL_LINK_LIFETIME = '3 minutes'

/** The "Forgot password" form. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').pipe(z.email('Enter a valid email address')),
})

export type ForgotPasswordFormValues = z.input<typeof forgotPasswordSchema>
export type ForgotPasswordValues = z.output<typeof forgotPasswordSchema>

/** A reset email could not be requested at all (Supabase unreachable or failing), never "no such account". */
export class PasswordResetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PasswordResetError'
  }
}

export const PASSWORD_RESET_UNAVAILABLE = 'Password reset is unavailable right now. Try again shortly.'

interface ProviderError {
  status?: number
  name?: string
}

/**
 * Whether a `resetPasswordForEmail` error means the request never worked: a network failure or a
 * Supabase server error. Every other answer, including rate limits (which Supabase only applies to an
 * address that has an account), is reported to the user exactly like success, so the page never
 * reveals whether an account exists.
 */
export function isPasswordResetUnavailable(error: ProviderError): boolean {
  if (error.name === 'AuthRetryableFetchError') return true
  return error.status === undefined || error.status === 0 || error.status >= 500
}
