import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { ApprovalsWaitingSummary } from '@/features/communications/components/ApprovalsWaitingSummary'

export const Route = createFileRoute('/communications/')({
  component: function CommunicationsScreen() {
    return (
      <section className="space-y-8">
        <PageHeader title="Communications" description="Tenant statement and payment messages, and owner updates." />
        {/* The message log is not built yet; what waits on a person is, so it shows here too. */}
        <ApprovalsWaitingSummary />
        <section aria-labelledby="communications-log" className="space-y-1">
          <h2 id="communications-log" className="text-base font-medium text-foreground">
            Message log
          </h2>
          <p className="text-sm text-muted-foreground">Not available yet. Messages awaiting a decision are under Approvals.</p>
        </section>
      </section>
    )
  },
})
