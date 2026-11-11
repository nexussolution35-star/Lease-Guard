import { formatCount, formatSADate, shareOf } from '@leaseguard/domain'
import { BarChart3 } from 'lucide-react'
import { useId } from 'react'

import { AppLink, ErrorState, LoadingState } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useCommunicationAnalytics } from '../api/queries'

const DEFAULT_RANGE = {}

/** The dashboard's summary of the workspace's WhatsApp activity over the last 30 days, for every member. */
export function CommunicationAnalyticsSummary() {
  const titleId = useId()
  const query = useCommunicationAnalytics(DEFAULT_RANGE)
  if (isAwaitingWorkspace(query)) return null
  const figures = query.data
  const delivered = figures ? shareOf(figures.delivered, figures.outbound) : undefined

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4" aria-hidden="true" />
          WhatsApp activity
        </CardTitle>
        <CardDescription>
          {figures ? <span>{`${formatSADate(figures.from)} to ${formatSADate(figures.to)}`}</span> : 'The last 30 days'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending ? <LoadingState label="Loading WhatsApp activity…" rows={1} /> : null}
        {query.isError ? (
          <ErrorState title="WhatsApp activity could not be loaded" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
        ) : null}
        {figures ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ['Received', formatCount(figures.inbound)],
              ['Sent', formatCount(figures.outbound)],
              ['Delivered', delivered === undefined ? formatCount(figures.delivered) : `${formatCount(figures.delivered)} (${delivered}%)`],
              ['Handovers', formatCount(figures.handovers)],
            ].map(([term, value]) => (
              <div key={term} className="space-y-0.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <AppLink to="/communications/analytics" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Open communication analytics
        </AppLink>
      </CardContent>
    </Card>
  )
}
