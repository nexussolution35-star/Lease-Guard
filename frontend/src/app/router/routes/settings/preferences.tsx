import { createFileRoute } from '@tanstack/react-router'

import { PreferencesScreen } from '@/features/account/components/PreferencesScreen'

export const Route = createFileRoute('/settings/preferences')({
  component: PreferencesScreen,
})
