import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/whatsapp')({
  component: function WhatsAppSettingsScreen() {
    return <ScreenPlaceholder title="WhatsApp" description="Simulated WhatsApp Business connection for this company." />
  },
})
