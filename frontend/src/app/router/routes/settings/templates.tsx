import { createFileRoute } from '@tanstack/react-router'

import { MessageTemplatesSettingsScreen } from '@/features/message-templates/components/MessageTemplatesSettingsScreen'

export const Route = createFileRoute('/settings/templates')({
  component: MessageTemplatesSettingsScreen,
})
