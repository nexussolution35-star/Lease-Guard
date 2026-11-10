import { z } from 'zod'

/**
 * Minimum new-password length. Supabase Auth enforces its own minimum (`minimum_password_length` in
 * supabase/config.toml); the app never accepts fewer than 8 characters, whatever that is set to.
 */
export const MIN_PASSWORD_LENGTH = 8
/** Supabase Auth (bcrypt) only uses the first 72 bytes of a password. */
export const MAX_PASSWORD_LENGTH = 72

/**
 * Choosing a password without the current one, from the session an emailed link created: the first
 * password after an invitation, or a new one after a password-recovery or password-change link.
 * Supabase Auth's secure password change (`secure_password_change`) only accepts a new password from
 * such a recently authenticated session, so signed-in users change their password through a link too.
 */
export const setPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((values) => values.confirmPassword === values.newPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match',
  })

export type SetPasswordValues = z.output<typeof setPasswordSchema>

/** Password change failure with a message safe to show on the form (no raw provider details). */
export class PasswordChangeError extends Error {
  /** The form field the message belongs to, when it is about one field. */
  readonly field: 'newPassword' | null

  constructor(message: string, field: PasswordChangeError['field'] = null, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PasswordChangeError'
    this.field = field
  }
}

interface ProviderError {
  status?: number
  code?: string
}

/** `updateUser({ password })` failed. */
export function newPasswordErrorFrom(error: ProviderError & Error): PasswordChangeError {
  if (error.code === 'same_password') {
    return new PasswordChangeError('Choose a password different from your current one.', 'newPassword', { cause: error })
  }
  if (error.code === 'weak_password') {
    return new PasswordChangeError('This password is too weak. Choose a longer or less common password.', 'newPassword', { cause: error })
  }
  if (error.code === 'reauthentication_needed' || error.code === 'reauthentication_not_valid') {
    // Secure password change: this session is no longer recent enough to set a password.
    return new PasswordChangeError(
      'For your security, this link has expired. Request a new password link and try again.',
      null,
      { cause: error },
    )
  }
  if (error.status === 429) {
    return new PasswordChangeError('Too many attempts. Wait a moment and try again.', null, { cause: error })
  }
  return new PasswordChangeError('Your password could not be changed right now. Try again shortly.', null, { cause: error })
}

// ------------------------------------------------------------------ password-change link

/**
 * How long the "Resend link" button waits after a link was sent. Supabase refuses another recovery
 * email to the same address within its `max_frequency` (60 seconds on hosted projects by default).
 */
export const PASSWORD_LINK_COOLDOWN_SECONDS = 60

export const PASSWORD_LINK_UNAVAILABLE = 'The link could not be sent right now. Try again shortly.'

/** A password-change link could not be sent. `retryAfterSeconds` is set when Supabase said when to retry. */
export class PasswordLinkError extends Error {
  readonly retryAfterSeconds: number | null

  constructor(message: string, retryAfterSeconds: number | null = null, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PasswordLinkError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const RETRY_AFTER = /after (\d+) seconds?/i

/**
 * `resetPasswordForEmail` failed for the signed-in user's own address. Unlike the signed-out "Forgot
 * password" page, rate limits are reported plainly: the address is the user's own, so nothing about
 * other accounts is revealed.
 */
export function passwordLinkErrorFrom(error: ProviderError & Error): PasswordLinkError {
  const rateLimited = error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit'
  if (!rateLimited) return new PasswordLinkError(PASSWORD_LINK_UNAVAILABLE, null, { cause: error })
  const match = RETRY_AFTER.exec(error.message)
  if (match) {
    const seconds = Math.max(1, Number(match[1]))
    return new PasswordLinkError(
      `A link was sent moments ago. You can request another in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
      seconds,
      { cause: error },
    )
  }
  return new PasswordLinkError('Too many emails were sent recently. Wait a few minutes and try again.', null, { cause: error })
}
