import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/notifications')({
  component: function NotificationSettingsScreen() {
    return <ScreenPlaceholder title="Notifications" description="Notice periods and reminder timing." />
  },
})
