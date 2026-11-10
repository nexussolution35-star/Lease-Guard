import { createFileRoute } from '@tanstack/react-router'

import { AgentSettingsScreen } from '@/features/whatsapp-agent/components/AgentSettingsScreen'

export const Route = createFileRoute('/settings/integrations/whatsapp/agent')({
  component: AgentSettingsScreen,
})
