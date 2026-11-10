/** Sign-in failure with a message safe to show on the form (no raw provider details). */
export class SignInError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SignInError'
  }
}

interface ProviderError {
  status?: number
  code?: string
}

/** Map a Supabase auth error to user-facing copy. */
export function signInErrorFrom(error: ProviderError & Error): SignInError {
  if (error.code === 'invalid_credentials' || error.status === 400) {
    return new SignInError('The email address or password is incorrect.', { cause: error })
  }
  if (error.code === 'email_not_confirmed') {
    return new SignInError('This account has not been confirmed yet. Contact your administrator.', { cause: error })
  }
  if (error.status === 429) {
    return new SignInError('Too many sign-in attempts. Wait a moment and try again.', { cause: error })
  }
  return new SignInError('Sign-in is unavailable right now. Try again shortly.', { cause: error })
}
