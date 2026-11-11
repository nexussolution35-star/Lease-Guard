import { createFileRoute } from '@tanstack/react-router'

import { MonitoringSettingsScreen } from '@/features/company/components/MonitoringSettingsScreen'

export const Route = createFileRoute('/settings/notifications')({
  component: MonitoringSettingsScreen,
})
