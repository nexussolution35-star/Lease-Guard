import { createFileRoute, redirect } from '@tanstack/react-router'

// WhatsApp is the only integration.
export const Route = createFileRoute('/settings/integrations/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/integrations/whatsapp', replace: true })
  },
})
