import { DASHBOARD_EVENT_FIGURES, formatCount, formatSADate, type DashboardEventFigure, type DashboardSummary } from '@leaseguard/domain'
import type { ReactNode } from 'react'

import { CurrencyDisplay, ErrorState, MetricCard, MetricGrid, SectionHeader } from '@/components/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useDashboardSummary } from '../api/queries'

/** The monitoring list filtered to the open events behind a figure: the same filter the API counted with. */
const openEventsOf = (figure: DashboardEventFigure) => `/monitoring?type=${DASHBOARD_EVENT_FIGURES[figure]}&status=open`

/** A finding waiting on someone shows a dot; only a non-zero danger figure is ever coloured (MetricCard). */
const attention = (count: number, tone: Tone): Tone => (count > 0 ? tone : 'neutral')

interface Figure {
  label: string
  href: string
  value: (summary: DashboardSummary) => ReactNode
  description?: (summary: DashboardSummary) => string | undefined
  tone?: (summary: DashboardSummary) => Tone
  lead?: boolean
}

interface Strip {
  id: string
  title: string
  description?: (summary: DashboardSummary) => string
  figures: readonly Figure[]
}

const count = (pick: (summary: DashboardSummary) => number) => (summary: DashboardSummary) => formatCount(pick(summary))

/** PRD §7.1, grouped by what a property manager acts on first. Every number is the API's; this only lays them out. */
const STRIPS: readonly Strip[] = [
  {
    id: 'dashboard-arrears',
    title: 'Arrears',
    description: (summary) =>
      `From the latest verified statement of each unit, as of ${formatSADate(summary.asOf)}. Monitoring figures: LeaseGuard takes no payments.`,
    figures: [
      {
        label: 'Outstanding balances',
        href: '/statements',
        lead: true,
        value: (summary) => <CurrencyDisplay amount={summary.totalOutstanding} tone="none" />,
      },
      {
        label: 'Tenants in arrears',
        href: '/statements',
        value: count((summary) => summary.tenantsInArrears),
        tone: (summary) => attention(summary.tenantsInArrears, 'warning'),
      },
      {
        label: 'Active payment arrangements',
        href: '/arrangements',
        value: count((summary) => summary.activeArrangements),
        description: () => 'Normal arrears reminders are paused for these tenants',
      },
    ],
  },
  {
    id: 'dashboard-lease-monitoring',
    title: 'Lease monitoring',
    description: () => 'Open findings on verified leases, from the daily monitoring.',
    figures: [
      {
        label: 'Rental escalation discrepancies',
        href: openEventsOf('escalationDiscrepancies'),
        value: count((summary) => summary.escalationDiscrepancies),
        tone: (summary) => attention(summary.escalationDiscrepancies, 'danger'),
      },
      {
        label: 'Upcoming lease expiries',
        href: openEventsOf('upcomingExpiries'),
        value: count((summary) => summary.upcomingExpiries),
        tone: (summary) => attention(summary.upcomingExpiries, 'warning'),
      },
      {
        label: 'Upcoming renewal deadlines',
        href: openEventsOf('renewalDeadlines'),
        value: count((summary) => summary.renewalDeadlines),
        tone: (summary) => attention(summary.renewalDeadlines, 'warning'),
      },
      {
        label: 'Expiring bank guarantees',
        href: openEventsOf('expiringGuarantees'),
        value: count((summary) => summary.expiringGuarantees),
        tone: (summary) => attention(summary.expiringGuarantees, 'warning'),
      },
    ],
  },
  {
    id: 'dashboard-waiting',
    title: 'Waiting on a person',
    figures: [
      {
        label: 'Statements to review',
        href: '/statements?status=review_required',
        value: count((summary) => summary.pendingStatementReviews),
        tone: (summary) => attention(summary.pendingStatementReviews, 'warning'),
      },
      {
        label: 'Messages awaiting approval',
        href: '/communications/approvals',
        value: count((summary) => summary.pendingApprovals),
        tone: (summary) => attention(summary.pendingApprovals, 'warning'),
      },
    ],
  },
  {
    id: 'dashboard-portfolio',
    title: 'Portfolio',
    description: () => 'Archived properties and their units are not counted.',
    figures: [
      { label: 'Properties', href: '/properties', value: count((summary) => summary.properties) },
      { label: 'Units', href: '/units', value: count((summary) => summary.units) },
      {
        label: 'Occupied units',
        href: '/units?occupancyStatus=occupied',
        value: count((summary) => summary.occupiedUnits),
        description: (summary) => `of ${formatCount(summary.units)} ${summary.units === 1 ? 'unit' : 'units'}`,
      },
      { label: 'Active leases', href: '/leases?status=active', value: count((summary) => summary.activeLeases) },
    ],
  },
]

export interface DashboardFiguresProps {
  className?: string
}

/**
 * The dashboard's figures (PRD §7.1) from one request, `GET /dashboard/summary`, in four hairline stat strips. Each
 * figure opens the list behind it, filtered the way the API counted it. While loading, one status says so for the
 * whole set (not one per figure); an error replaces the figures with a retry.
 */
export function DashboardFigures({ className }: DashboardFiguresProps) {
  const query = useDashboardSummary()
  if (isAwaitingWorkspace(query)) return null

  if (query.isError) {
    return (
      <section aria-labelledby="dashboard-figures-error" className={className}>
        <h2 id="dashboard-figures-error" className="sr-only">
          Dashboard figures
        </h2>
        <ErrorState
          title="Could not load the dashboard figures"
          error={describeApiError(query.error, 'Try again in a moment.')}
          onRetry={() => void query.refetch()}
        />
      </section>
    )
  }

  const summary = query.data
  return (
    <div className={cn('flex flex-col gap-10', className)} aria-busy={summary ? undefined : true}>
      {summary ? null : (
        <p role="status" className="sr-only">
          Loading the dashboard figures…
        </p>
      )}
      {STRIPS.map((strip) => (
        <section key={strip.id} aria-label={strip.title} className="space-y-3">
          <SectionHeader title={strip.title} {...(summary && strip.description ? { description: strip.description(summary) } : {})} />
          <MetricGrid columns={strip.figures.length === 3 ? 3 : strip.figures.length === 2 ? 2 : 4}>
            {strip.figures.map((figure) => {
              const description = summary ? figure.description?.(summary) : undefined
              return (
                <MetricCard
                  key={figure.label}
                  label={figure.label}
                  href={figure.href}
                  lead={figure.lead ?? false}
                  tone={summary && figure.tone ? figure.tone(summary) : 'neutral'}
                  value={summary ? figure.value(summary) : <Skeleton aria-hidden="true" className={figure.lead ? 'h-[2.625rem] w-32' : 'h-6 w-12'} />}
                  {...(description ? { description } : {})}
                />
              )
            })}
          </MetricGrid>
        </section>
      ))}
    </div>
  )
}
