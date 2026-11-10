import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginScreen } from '@/features/auth/components/LoginScreen'
import { loginSearchSchema } from '@/features/auth/loginSchema'
import { safeRedirectTarget } from '@/features/auth/redirect'

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  beforeLoad: ({ context, search }) => {
    // A signed-in user goes straight to the page they asked for.
    if (context.auth.status === 'authenticated') throw redirect({ href: safeRedirectTarget(search.redirect), replace: true })
  },
  component: LoginScreen,
})
