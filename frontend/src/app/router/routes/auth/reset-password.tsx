import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { ResetPasswordScreen } from '@/features/auth/components/ResetPasswordScreen'
import { getAuthCallback, readPasswordSetup } from '@/services/api/authCallback'

export const Route = createFileRoute('/auth/reset-password')({
  component: function ResetPasswordRoute() {
    // Read once: setting the password clears the marker, and the screen navigates away itself.
    const [passwordSetup] = useState(readPasswordSetup)
    return <ResetPasswordScreen callback={getAuthCallback()} passwordSetup={passwordSetup} />
  },
})
