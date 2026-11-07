import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/whatsapp/conversations')({
  component: function WhatsAppConversationsScreen() {
    return <ScreenPlaceholder title="Conversations" description="Simulated WhatsApp conversations with tenants." />
  },
})
