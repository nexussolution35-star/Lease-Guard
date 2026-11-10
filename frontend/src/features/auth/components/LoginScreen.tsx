import { AppLink } from '@/components/shared'

import { useAuth } from '../authContext'
import { FORGOT_PASSWORD_PATH } from '../redirect'
import { AuthPageFrame } from './AuthPageFrame'
import { LoginForm } from './LoginForm'

/**
 * Full-page sign-in. After a successful sign-in the auth state changes, the router
 * re-runs its guards and /login redirects to the requested page.
 */
export function LoginScreen() {
  const { signIn } = useAuth()
  return (
    <AuthPageFrame
      title="Sign in to LeaseGuard"
      description="Use the email address and password for your LeaseGuard account."
      footer={
        <AppLink to={FORGOT_PASSWORD_PATH} className="font-medium text-primary underline-offset-4 hover:underline">
          Forgot your password?
        </AppLink>
      }
    >
      <LoginForm onSubmit={signIn} />
    </AuthPageFrame>
  )
}
