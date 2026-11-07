import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/users')({
  component: function UsersSettingsScreen() {
    return <ScreenPlaceholder title="Users" description="People with access to this workspace." />
  },
})
