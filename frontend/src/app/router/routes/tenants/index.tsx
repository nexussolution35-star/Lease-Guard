import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/tenants/')({
  component: function TenantsScreen() {
    return <ScreenPlaceholder title="Tenants" description="Tenants, contact details and WhatsApp status." />
  },
})
