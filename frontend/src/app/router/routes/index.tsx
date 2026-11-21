import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { ApprovalsWaitingSummary } from '@/features/communications/components/ApprovalsWaitingSummary'
import { CommunicationAnalyticsSummary } from '@/features/communications/components/CommunicationAnalyticsSummary'
import { WhatsAppSetupSummary } from '@/features/whatsapp-integration/components/WhatsAppSetupSummary'

export const Route = createFileRoute('/')({
  component: function DashboardScreen() {
    return (
      <section>
        <PageHeader title="Dashboard" />
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-8">
            {/* What waits on a person leads: the tenant messages awaiting a property manager's sign-off. */}
            <ApprovalsWaitingSummary showAction />
            {/* Every member: the last 30 days of WhatsApp activity, with a link to the full figures (ticket 12). */}
            <CommunicationAnalyticsSummary />
          </div>
          {/* Company admins see the WhatsApp setup until it is done (ticket 11), in the side rail. */}
          <WhatsAppSetupSummary className="lg:w-80 lg:shrink-0 lg:border-l lg:border-border lg:pl-6" />
        </div>
      </section>
    )
  },
})
