import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/preferences')({
  component: function PreferencesScreen() {
    return <ScreenPlaceholder title="Preferences" description="Display preferences for this browser." />
  },
})
