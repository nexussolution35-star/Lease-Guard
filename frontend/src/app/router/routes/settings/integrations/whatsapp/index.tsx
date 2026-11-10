import { createFileRoute } from '@tanstack/react-router'

import { WhatsAppIntegrationScreen } from '@/features/whatsapp-integration/components/WhatsAppIntegrationScreen'

export const Route = createFileRoute('/settings/integrations/whatsapp/')({
  component: WhatsAppIntegrationScreen,
})
