import { createFileRoute, redirect } from '@tanstack/react-router'

import { ForgotPasswordScreen } from '@/features/auth/components/ForgotPasswordScreen'

export const Route = createFileRoute('/auth/forgot-password')({
  beforeLoad: ({ context }) => {
    // A signed-in user changes their password from the account menu instead.
    if (context.auth.status === 'authenticated') throw redirect({ to: '/', replace: true })
  },
  component: ForgotPasswordScreen,
})
