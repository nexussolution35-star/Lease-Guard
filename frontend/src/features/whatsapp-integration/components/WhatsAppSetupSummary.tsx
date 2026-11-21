import { AppLink, ErrorState, LoadingState, ProgressIndicator, SectionHeader } from '@/components/shared'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { cn } from '@/lib/utils'

import { useWhatsAppSetup } from '../api/queries'
import type { WhatsAppSetup } from '../api/source'

function headline(setup: WhatsAppSetup): string {
  if (setup.activation.active) return setup.readyForActivation ? 'WhatsApp is active.' : 'WhatsApp is active, but a required step is no longer verified.'
  if (setup.readyForActivation) return 'Every required step is verified. WhatsApp is ready to activate.'
  const next = setup.steps.find((step) => step.required && step.state !== 'done' && step.state !== 'blocked')
  if (!next) return 'Finish the required steps to activate WhatsApp.'
  return next.state === 'waiting_on_meta' ? `Waiting on Meta: ${next.title}` : `Next step: ${next.guidance}`
}

/** The dashboard's WhatsApp setup summary, for company admins only (the steps are on the WhatsApp page). */
export function WhatsAppSetupSummary({ className }: { className?: string }) {
  const isAdmin = useIsCompanyAdmin()
  const query = useWhatsAppSetup({ enabled: isAdmin })
  if (!isAdmin || isAwaitingWorkspace(query)) return null
  return (
    <section aria-label="WhatsApp setup" className={cn('space-y-4', className)}>
      {/* The link sits under the progress, so the summary reads the same in the dashboard's narrow side rail. */}
      <SectionHeader title="WhatsApp setup" description="Only steps LeaseGuard has verified count as done." />
      {query.data ? (
        <>
          <p className="text-sm text-pretty text-foreground">{headline(query.data)}</p>
          <ProgressIndicator
            value={(query.data.completedSteps / query.data.totalSteps) * 100}
            label={`${query.data.completedSteps} of ${query.data.totalSteps} steps done`}
            tone={query.data.activation.active || query.data.readyForActivation ? 'success' : 'neutral'}
            className="max-w-sm"
          />
        </>
      ) : null}
      {query.isPending ? <LoadingState label="Loading the WhatsApp setup…" rows={2} /> : null}
      {query.isError ? (
        <ErrorState title="The WhatsApp setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} className="border-0 px-0 py-0" />
      ) : null}
      <AppLink to="/settings/integrations/whatsapp" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
        Open the WhatsApp setup
      </AppLink>
    </section>
  )
}
