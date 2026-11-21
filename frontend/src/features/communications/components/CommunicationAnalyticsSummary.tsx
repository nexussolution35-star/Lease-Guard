import { formatCount, shareOf, type CommunicationAnalytics } from '@leaseguard/domain'

import { AppLink, ErrorState, SectionHeader } from '@/components/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useCommunicationAnalytics } from '../api/queries'
import { useDateFormatter } from '@/lib/dateFormat'

const DEFAULT_RANGE = {}


// A compact, even ledger line like the dashboard's portfolio: the outstanding balance is the dashboard's one lead figure.
const STRIP_CLASSES = 'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4'
const CELL_CLASSES = 'flex flex-col gap-1.5 bg-card px-4 py-3'
const TERMS = ['Received', 'Sent', 'Delivered', 'Handovers'] as const

type Cell = [term: (typeof TERMS)[number], value: string, share?: string]

function cellsOf(figures: CommunicationAnalytics, delivered: number | undefined): Cell[] {
  return [
    ['Received', formatCount(figures.inbound)],
    ['Sent', formatCount(figures.outbound)],
    delivered === undefined ? ['Delivered', formatCount(figures.delivered)] : ['Delivered', formatCount(figures.delivered), `(${delivered}%)`],
    ['Handovers', formatCount(figures.handovers)],
  ]
}

/** The dashboard's summary of the workspace's WhatsApp activity over the last 30 days, for every member. */
export function CommunicationAnalyticsSummary() {
  const { date: formatDate } = useDateFormatter()
  const query = useCommunicationAnalytics(DEFAULT_RANGE)
  if (isAwaitingWorkspace(query)) return null
  const figures = query.data
  const delivered = figures ? shareOf(figures.delivered, figures.outbound) : undefined

  return (
    <section aria-label="WhatsApp activity" className="space-y-3">
      <SectionHeader
        title="WhatsApp activity"
        description={figures ? `${formatDate(figures.from)} to ${formatDate(figures.to)}` : 'The last 30 days'}
        actions={
          <AppLink to="/communications/analytics" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Open communication analytics
          </AppLink>
        }
      />
      {query.isPending ? (
        <div role="status" aria-live="polite" aria-busy="true" className={STRIP_CLASSES}>
          <span className="sr-only">Loading WhatsApp activity…</span>
          {TERMS.map((term) => (
            <div key={term} className={CELL_CLASSES}>
              <span className="text-xs font-medium text-muted-foreground">{term}</span>
              <Skeleton className="h-5 w-10" />
            </div>
          ))}
        </div>
      ) : null}
      {query.isError ? (
        <ErrorState title="WhatsApp activity could not be loaded" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
      ) : null}
      {figures ? (
        // One stat strip (S9), kept as a description list: the hairlines are the 1px gaps over the border colour.
        <dl className={STRIP_CLASSES}>
          {cellsOf(figures, delivered).map(([term, value, share]) => (
            <div key={term} className={CELL_CLASSES}>
              <dt className="text-xs text-muted-foreground">{term}</dt>
              <dd
                className="text-xl leading-none font-medium tabular-nums text-foreground"
              >
                {value}
                {share ? <span className="text-sm font-normal text-muted-foreground"> {share}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
