import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/roles')({
  component: function RolesSettingsScreen() {
    return <ScreenPlaceholder title="Roles" description="What each role can see and do." />
  },
})
