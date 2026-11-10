import { createFileRoute, redirect } from '@tanstack/react-router'

// Moved to Settings → Integrations → WhatsApp; old links keep working.
export const Route = createFileRoute('/settings/whatsapp')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/integrations/whatsapp', replace: true })
  },
})
