import { DASHBOARD_EVENT_FIGURES, formatCount, type DashboardEventFigure, type DashboardSummary } from '@leaseguard/domain'
import type { ReactNode } from 'react'

import { AppLink, CurrencyDisplay, ErrorState, SectionHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import type { Tone } from '@/lib/labels'
import { TONE_SOLID_CLASSES, TONE_TEXT_CLASSES } from '@/components/shared/tone'
import { cn } from '@/lib/utils'

import { useDashboardSummary } from '../api/queries'
import { useDateFormatter } from '@/lib/dateFormat'

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
  description?: (summary: DashboardSummary, formatDate: (iso: string) => string) => string
  figures: readonly Figure[]
}

const count = (pick: (summary: DashboardSummary) => number) => (summary: DashboardSummary) => formatCount(pick(summary))

/** PRD §7.1, grouped by what a property manager acts on first. Every number is the API's; this only lays them out. */
const STRIPS: readonly Strip[] = [
  {
    id: 'dashboard-arrears',
    title: 'Arrears',
    description: (summary, formatDate) =>
      `From the latest verified statement of each unit, as of ${formatDate(summary.asOf)}. Monitoring figures: LeaseGuard takes no payments.`,
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
        href: '/arrangements?status=active',
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

/** Rows of the work list: what waits on a person first, then the open findings on verified leases. */
const ATTENTION_GROUPS: readonly { title: string; stripId: string }[] = [
  { title: 'Waiting on a person', stripId: 'dashboard-waiting' },
  { title: 'Lease monitoring', stripId: 'dashboard-lease-monitoring' },
]

const strip = (id: string) => STRIPS.find((candidate) => candidate.id === id)!

const ROW_CLASSES =
  'flex min-h-11 items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden focus-visible:ring-inset'

/** One work-list row: a status dot, the label, and the count at the right edge (dimmed at nought). */
function AttentionRow({ figure, summary }: { figure: Figure; summary: DashboardSummary | undefined }) {
  const tone: Tone = summary && figure.tone ? figure.tone(summary) : 'neutral'
  const value = summary ? figure.value(summary) : null
  const isZero = value === '0'
  // Only a non-zero danger figure is coloured; other findings carry their state in the dot (DESIGN: Quarantine Rule).
  const alarming = tone === 'danger' && !isZero
  return (
    <li>
      <AppLink to={figure.href} className={ROW_CLASSES}>
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', tone === 'neutral' ? 'bg-border' : TONE_SOLID_CLASSES[tone])} />
        <span className="min-w-0 flex-1 truncate">{figure.label}</span>
        <span className={cn('text-base font-medium tabular-nums', isZero ? 'text-muted-foreground' : alarming ? TONE_TEXT_CLASSES[tone] : 'text-foreground')}>
          {value ?? <Skeleton aria-hidden="true" className="h-5 w-6" />}
        </span>
      </AppLink>
    </li>
  )
}

/**
 * The dashboard (PRD §7.1) from one request, `GET /dashboard/summary`, organised by what a property manager acts on:
 * a work list of what needs attention today beside the arrears figure, then the portfolio as one ledger line. Every
 * figure opens the list behind it, filtered the way the API counted it. While loading, one status says so for the
 * whole set; an error replaces the figures with a retry.
 */
export function DashboardFigures({ className }: DashboardFiguresProps) {
  const query = useDashboardSummary()
  const { date: formatDate } = useDateFormatter()
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
  const arrears = strip('dashboard-arrears')
  const [outstanding, ...arrearsLines] = arrears.figures
  const portfolio = strip('dashboard-portfolio')
  const approvalsWaiting = (summary?.pendingApprovals ?? 0) > 0
  const occupiedShare = summary && summary.units > 0 ? Math.round((summary.occupiedUnits / summary.units) * 100) : 0

  return (
    <div className={cn('flex flex-col gap-10', className)} aria-busy={summary ? undefined : true}>
      {summary ? null : (
        <p role="status" className="sr-only">
          Loading the dashboard figures…
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Needs attention" className="space-y-3">
          <SectionHeader
            title="Needs attention"
            description="Waiting on a person, and open findings on verified leases"
            {...(approvalsWaiting
              ? {
                  actions: (
                    <Button asChild size="sm">
                      <AppLink to="/communications/approvals">Review messages</AppLink>
                    </Button>
                  ),
                }
              : {})}
          />
          <div className="divide-y divide-border rounded-lg border border-border">
            {ATTENTION_GROUPS.map((group) => (
              <section key={group.stripId} aria-label={group.title}>
                <h3 className="px-3 pt-3 pb-1 text-xs text-muted-foreground">{group.title}</h3>
                <ul className="pb-1">
                  {strip(group.stripId).figures.map((figure) => (
                    <AttentionRow key={figure.label} figure={figure} summary={summary} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section aria-label={arrears.title} className="space-y-3">
          <SectionHeader title={arrears.title} {...(summary && arrears.description ? { description: arrears.description(summary, formatDate) } : {})} />
          <div className="rounded-lg border border-border">
            {outstanding ? (
              <AppLink to={outstanding.href} className={cn(ROW_CLASSES, 'flex-col items-start gap-2 px-5 py-5')}>
                <span className="text-xs text-muted-foreground">{outstanding.label}</span>
                <span className="text-[clamp(1.75rem,4vw,2.625rem)] leading-none font-semibold tracking-[-0.02em] tabular-nums">
                  {summary ? outstanding.value(summary) : <Skeleton aria-hidden="true" className="h-[2.625rem] w-40" />}
                </span>
              </AppLink>
            ) : null}
            <ul className="border-t border-border py-1">
              {arrearsLines.map((figure) => (
                <AttentionRow key={figure.label} figure={figure} summary={summary} />
              ))}
            </ul>
            {summary ? (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground italic">Normal arrears reminders are paused while an arrangement is active</p>
            ) : null}
          </div>
        </section>
      </div>

      <section aria-label={portfolio.title} className="space-y-3">
        <SectionHeader title={portfolio.title} {...(portfolio.description && summary ? { description: portfolio.description(summary, formatDate) } : {})} />
        {/* One ledger line rather than a row of identical cards; occupancy is drawn to scale. */}
        <ul className="grid grid-cols-2 divide-border rounded-lg border border-border sm:grid-cols-4 sm:divide-x">
          {portfolio.figures.map((figure) => {
            const description = summary ? figure.description?.(summary) : undefined
            const isOccupied = figure.href.includes('occupancyStatus')
            return (
              <li key={figure.label}>
              <AppLink to={figure.href} className={cn(ROW_CLASSES, 'h-full flex-col items-start gap-1.5 px-4 py-3')}>
                <span className="text-xs text-muted-foreground">{figure.label}</span>
                <span className="flex w-full items-baseline gap-1.5 text-xl leading-none font-medium tabular-nums">
                  {summary ? figure.value(summary) : <Skeleton aria-hidden="true" className="h-5 w-8" />}
                  {description ? <span className="text-xs font-normal text-muted-foreground">{description}</span> : null}
                </span>
                {isOccupied && summary ? (
                  <span aria-hidden="true" className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${occupiedShare}%` }} />
                  </span>
                ) : null}
              </AppLink>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
