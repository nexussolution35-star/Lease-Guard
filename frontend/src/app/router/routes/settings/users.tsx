import { createFileRoute } from '@tanstack/react-router'

import { UsersSettingsScreen } from '@/features/users/components/UsersSettingsScreen'

export const Route = createFileRoute('/settings/users')({
  component: UsersSettingsScreen,
})
