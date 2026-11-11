import { createFileRoute } from '@tanstack/react-router'

import { RolesSettingsScreen } from '@/features/users/components/RolesSettingsScreen'

export const Route = createFileRoute('/settings/roles')({
  component: RolesSettingsScreen,
})
