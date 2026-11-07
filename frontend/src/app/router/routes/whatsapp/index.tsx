import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/whatsapp/')({
  component: function WhatsAppScreen() {
    return <ScreenPlaceholder title="WhatsApp" description="Simulated WhatsApp Business channel status and activity." />
  },
})
