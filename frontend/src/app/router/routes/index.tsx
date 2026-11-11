import { createFileRoute } from '@tanstack/react-router'
import { Construction } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared'
import { WhatsAppSetupSummary } from '@/features/whatsapp-integration/components/WhatsAppSetupSummary'

export const Route = createFileRoute('/')({
  component: function DashboardScreen() {
    return (
      <section className="space-y-6">
        <PageHeader title="Dashboard" description="Portfolio health, monitoring events and items awaiting your action." className="pb-0" />
        {/* Company admins see the WhatsApp setup until it is done (ticket 11); the rest of the dashboard comes later. */}
        <WhatsAppSetupSummary />
        <EmptyState
          icon={Construction}
          title="Screen coming in the next stage"
          description="This screen is assembled in the next stage. Navigation, workspace scoping and data services are already in place."
        />
      </section>
    )
  },
})
