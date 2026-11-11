import { useId } from 'react'
import { MessageCircle } from 'lucide-react'

import { AppLink, ErrorState, LoadingState, ProgressIndicator } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useWhatsAppSetup } from '../api/queries'
import type { WhatsAppSetup } from '../api/source'

function headline(setup: WhatsAppSetup): string {
  if (setup.activation.active) return setup.readyForActivation ? 'WhatsApp is active.' : 'WhatsApp is active, but a required step is no longer verified.'
  if (setup.readyForActivation) return 'Every required step is verified. WhatsApp is ready to activate.'
  const next = setup.steps.find((step) => step.required && step.state !== 'done' && step.state !== 'blocked')
  if (!next) return 'Finish the required steps to activate WhatsApp.'
  return next.state === 'waiting_on_meta' ? `Waiting on Meta: ${next.title.toLowerCase()}.` : `Next: ${next.title.toLowerCase()}.`
}

/** The dashboard's WhatsApp setup summary, for company admins only (the steps are on the WhatsApp page). */
export function WhatsAppSetupSummary() {
  const isAdmin = useIsCompanyAdmin()
  const titleId = useId()
  const query = useWhatsAppSetup({ enabled: isAdmin })
  if (!isAdmin || isAwaitingWorkspace(query)) return null
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" aria-hidden="true" />
          WhatsApp setup
        </CardTitle>
        <CardDescription>Only steps LeaseGuard has verified count as done.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending ? <LoadingState label="Loading the WhatsApp setup…" rows={1} /> : null}
        {query.isError ? <ErrorState title="The WhatsApp setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          <>
            <ProgressIndicator
              value={(query.data.completedSteps / query.data.totalSteps) * 100}
              label={`${query.data.completedSteps} of ${query.data.totalSteps} steps done`}
              tone={query.data.activation.active || query.data.readyForActivation ? 'success' : 'primary'}
            />
            <p className="text-sm text-foreground">{headline(query.data)}</p>
            <AppLink to="/settings/integrations/whatsapp" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Open the WhatsApp setup
            </AppLink>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
