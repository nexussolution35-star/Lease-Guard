import type { MonitoringEventTargetStatus } from '@leaseguard/api-client'
import {
  daysBetween,
  daysUntilExpiry,
  daysUntilRenewalDeadline,
  isOpenEventStatus,
  isoToday,
  nextEventStatuses,
  renewalNoticeDeadline,
  type EventCalculation,
  type Lease,
  type MonitoringEventListItem,
  type PaymentArrangement,
  type Statement,
} from '@leaseguard/domain'
import { useState, type ReactNode } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  ActivityTimeline,
  AppLink,
  CurrencyDisplay,
  DateDisplay,
  InformationGrid,
  InformationItem,
  MetricCard,
  MetricGrid,
  PriorityBadge,
  SectionHeader,
  SignOff,
  StatusBadge,
  StatusDot,
  type ActivityTimelineEntry,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { canReadAuditLog } from '@/features/account/permissions'
import { useActiveRole, useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useArrangementQuery } from '@/features/arrangements/api/queries'
import { useAuditLogList } from '@/features/audit/api/queries'
import { useLeaseQuery } from '@/features/leases/api/queries'
import { useStatementQuery } from '@/features/statements/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { calculationLabels, EXPECTED_SOURCE, historyEntryFrom, orderedActions, STATUS_ACTIONS } from '../eventPresentation'
import { StatusChangeDialog } from './StatusChangeDialog'
import { useDateFormatter } from '@/lib/dateFormat'

export interface MonitoringEventDetailScreenProps {
  event: MonitoringEventListItem
}

/** In the `lg` rail each detail reads as one row, label left and value right, as in a ledger. */
const RAIL_ITEM = 'lg:grid lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-3 lg:space-y-0 lg:[&>dt]:font-normal'
/** An event has a handful of status changes; one page holds its whole history. */
const HISTORY_PAGE_SIZE = 50

const recordLink = (to: string, label: ReactNode) => (
  <AppLink to={to} className="text-foreground tabular-nums hover:underline">
    {label}
  </AppLink>
)

/**
 * One monitoring event: what was found and what to do, the calculation behind it with the lease, statement or
 * arrangement it came from, the outcome (who resolved or dismissed it, and why), its status history, and its
 * records in a side rail. Writers move it along the domain workflow (`nextEventStatuses`); the API checks every move
 * again and the database records who made it. Every figure is the one the monitoring rule stored on the event.
 */
export function MonitoringEventDetailScreen({ event }: MonitoringEventDetailScreenProps) {
  const role = useActiveRole()
  const isWriter = useIsCompanyWriter()
  const canSeeHistory = canReadAuditLog(role)
  const [moving, setMoving] = useState<MonitoringEventTargetStatus | null>(null)
  // The South African date when the screen opened; days left on a date finding are counted from this day.
  const [today] = useState(() => isoToday(new Date()))

  const lease = useLeaseQuery(event.leaseId ?? '', { enabled: event.leaseId !== undefined })
  const statement = useStatementQuery(event.statementId ?? '', { enabled: event.statementId !== undefined })
  const arrangement = useArrangementQuery(event.arrangementId ?? '', { enabled: event.arrangementId !== undefined })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const history = useAuditLogList(
    { page: 1, pageSize: HISTORY_PAGE_SIZE, entityType: 'monitoring_event', entityId: event.id },
    { enabled: canSeeHistory },
  )

  /** A member's name only when it is loaded: a sign-off never shows a placeholder as if it were a person. */
  const signerOf = (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined

  const actions = isWriter ? orderedActions(nextEventStatuses(event.status)) : []
  const historyEntries: ActivityTimelineEntry[] = [
    ...(history.data?.items ?? []).map((log) => historyEntryFrom(log, signerOf(log.actorUserId))),
    { id: 'raised', title: `Raised as ${labelFor(event.type).toLowerCase()}`, description: 'By LeaseGuard monitoring.', at: event.createdAt },
  ]

  return (
    <section>
      <PageHeader
        title={event.title}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{labelFor(event.type)}</span>
            <span aria-hidden="true">·</span>
            <PriorityBadge priority={event.priority} />
            <span aria-hidden="true">·</span>
            <StatusBadge status={event.status} />
          </p>
        }
        actions={
          actions.length > 0 ? (
            <>
              {actions.map((to) => (
                // The forward step is the view's one primary action and sits last; dismissing is an outline button.
                <Button key={to} type="button" variant={to === 'dismissed' ? 'outline' : 'default'} onClick={() => setMoving(to)}>
                  {STATUS_ACTIONS[to].label}
                </Button>
              ))}
            </>
          ) : null
        }
      />

      {/* DOM order is the phone order: the work, then details; from `lg` the details move into a right rail. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
          <section aria-label="Finding" className="space-y-3">
            <SectionHeader title="Finding" />
            <div className="space-y-4 border-y border-border py-3">
              <p className="max-w-prose text-sm text-pretty text-foreground">{event.description}</p>
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">Recommended action</h3>
                <p className="max-w-prose text-sm text-pretty text-foreground">{event.recommendedAction}</p>
              </div>
            </div>
          </section>

          <section aria-label="Calculation" className="space-y-3">
            <SectionHeader title="Calculation" description="How the finding was worked out, from the records below." />
            <Calculation event={event} lease={lease.data ?? null} today={today} />
          </section>

          <section aria-label="Sources" className="space-y-3">
            <SectionHeader title="Sources" description="The verified records the finding was raised from." />
            <Sources
              event={event}
              lease={event.leaseId ? { data: lease.data, isPending: lease.isPending } : null}
              statement={event.statementId ? { data: statement.data, isPending: statement.isPending } : null}
              arrangement={event.arrangementId ? { data: arrangement.data, isPending: arrangement.isPending } : null}
              signerOf={signerOf}
            />
          </section>

          <section aria-label="Outcome" className="space-y-3">
            <SectionHeader title="Outcome" />
            <div className="space-y-3 border-y border-border py-3">
              {event.status === 'dismissed' && event.dismissal ? (
                <>
                  <SignOff by={signerOf(event.dismissal.dismissedByUserId)} at={event.dismissal.dismissedAt} pendingLabel="Dismissed" />
                  <div className="space-y-1">
                    <h3 className="text-xs font-medium text-muted-foreground">Reason for dismissal</h3>
                    <p className="max-w-prose text-sm break-words text-foreground">{event.dismissal.reason}</p>
                  </div>
                </>
              ) : event.status === 'resolved' ? (
                <SignOff by={signerOf(event.resolvedByUserId)} at={event.resolvedAt} pendingLabel="Resolved" />
              ) : (
                <SignOff pendingLabel={isOpenEventStatus(event.status) ? `Open: ${labelFor(event.status).toLowerCase()}` : labelFor(event.status)} />
              )}
              {event.status !== 'dismissed' && event.resolutionNotes ? (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium text-muted-foreground">{event.status === 'resolved' ? 'Resolution notes' : 'Latest note'}</h3>
                  <p className="max-w-prose text-sm break-words text-foreground">{event.resolutionNotes}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section aria-label="History" className="space-y-3">
            <SectionHeader title="History" description="Every status change, newest first, with who made it and the note given." />
            {canSeeHistory ? (
              <ActivityTimeline
                label={`History of ${event.title}`}
                items={historyEntries}
                isLoading={history.isPending && !history.isError}
                error={history.isError ? describeApiError(history.error, 'Try again in a moment.') : null}
                onRetry={() => void history.refetch()}
              />
            ) : (
              <p className="text-sm text-muted-foreground">The history is kept in the audit log, which property owners do not see.</p>
            )}
          </section>
        </div>

        <section aria-label="Details" className="space-y-4 lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
            <InformationItem label="Property" className={RAIL_ITEM} value={recordLink(`/properties/${encodeURIComponent(event.propertyId)}`, event.propertyName || 'Property')} />
            {event.unitId ? (
              <InformationItem label="Unit" className={RAIL_ITEM} value={recordLink(`/units/${encodeURIComponent(event.unitId)}`, event.unitNumber ?? 'Unit')} />
            ) : null}
            {event.tenantId ? (
              <InformationItem label="Tenant" className={RAIL_ITEM} value={recordLink(`/tenants/${encodeURIComponent(event.tenantId)}`, event.tenantName ?? 'Tenant')} />
            ) : null}
            {event.leaseId ? (
              <InformationItem label="Lease" className={RAIL_ITEM} value={recordLink(`/leases/${encodeURIComponent(event.leaseId)}`, event.leaseReference ?? 'Lease')} />
            ) : null}
            <InformationItem label="Identified" className={RAIL_ITEM} value={<DateDisplay value={event.identifiedOn} className="tabular-nums" />} />
            <InformationItem label="Due" className={RAIL_ITEM} value={event.dueDate ? <DateDisplay value={event.dueDate} className="tabular-nums" /> : 'No due date'} />
            <InformationItem label="Assigned to" className={RAIL_ITEM} value={event.assigneeName ?? 'Unassigned'} />
            <InformationItem label="Event ID" className={cn(RAIL_ITEM, 'break-all')} value={<span className="font-mono text-xs">{event.id}</span>} />
          </InformationGrid>
        </section>
      </div>

      {moving ? <StatusChangeDialog event={event} to={moving} onClose={() => setMoving(null)} /> : null}
    </section>
  )
}

/** The figures and steps the rule stored, or for a date finding the dates of its verified lease. */
function Calculation({ event, lease, today }: { event: MonitoringEventListItem; lease: Lease | null; today: string }) {
  const { date: formatDate } = useDateFormatter()
  if (event.calculation) return <StoredCalculation event={event} calculation={event.calculation} />
  const rows = lease ? dateTrace(event, lease, today, formatDate) : null
  if (rows && rows.length > 0) {
    return (
      <InformationGrid columns={2} className="gap-y-3 border-y border-border py-3">
        {rows.map((row) => (
          <InformationItem key={row.label} label={row.label} value={row.value} />
        ))}
      </InformationGrid>
    )
  }
  return (
    <p className="border-y border-border py-3 text-sm text-muted-foreground">
      {event.type === 'statement_review_required'
        ? 'No calculation: this event asks for the statement below to be reviewed before its figures are used.'
        : 'No calculation is stored with this event.'}
    </p>
  )
}

function StoredCalculation({ event, calculation }: { event: MonitoringEventListItem; calculation: EventCalculation }) {
  const labels = calculationLabels(event.type)
  const { expectedAmount, actualAmount, difference } = calculation
  const source = EXPECTED_SOURCE[event.type]
  return (
    <div className="space-y-4">
      {expectedAmount !== undefined || actualAmount !== undefined || difference !== undefined ? (
        <MetricGrid>
          {difference !== undefined ? (
            <MetricCard lead label={labels.difference} value={<CurrencyDisplay amount={difference} />} tone={difference !== 0 ? 'danger' : 'neutral'} />
          ) : null}
          {expectedAmount !== undefined ? <MetricCard label={labels.expected} value={<CurrencyDisplay amount={expectedAmount} />} /> : null}
          {actualAmount !== undefined ? (
            <MetricCard lead={difference === undefined} label={labels.actual} value={<CurrencyDisplay amount={actualAmount} />} />
          ) : null}
        </MetricGrid>
      ) : null}
      {calculation.steps.length > 0 ? (
        <ol aria-label="Calculation steps" className="divide-y divide-border border-y border-border">
          {calculation.steps.map((step, index) => (
            <li key={`${index}:${step}`} className="flex gap-3 py-2 text-sm text-foreground tabular-nums">
              <span aria-hidden="true" className="w-5 shrink-0 text-right text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {source ? <p className="text-xs text-muted-foreground italic">{source}</p> : null}
    </div>
  )
}

function daysText(days: number): string {
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days === 0) return 'today'
  return `${days} days left`
}

/** Expiry, renewal-deadline and guarantee-expiry findings: the lease dates they were raised from, via the domain rules. */
function dateTrace(event: MonitoringEventListItem, lease: Lease, today: string, formatDate: (iso: string) => string): { label: string; value: ReactNode }[] | null {
  const dated = (date: string, days: number) => (
    <span className="tabular-nums">
      {formatDate(date)}
      <span className="text-muted-foreground"> · {daysText(days)}</span>
    </span>
  )
  switch (event.type) {
    case 'lease_expiry':
      return [
        { label: 'Lease expires', value: dated(lease.expiryDate, daysUntilExpiry(lease, today)) },
        { label: 'Commenced', value: <span className="tabular-nums">{formatDate(lease.commencementDate)}</span> },
      ]
    case 'renewal_notice_deadline': {
      const deadline = renewalNoticeDeadline(lease)
      const days = daysUntilRenewalDeadline(lease, today)
      return [
        { label: 'Lease expires', value: <span className="tabular-nums">{formatDate(lease.expiryDate)}</span> },
        {
          label: 'Notice period',
          value: lease.renewalOption.noticePeriodMonths === undefined ? 'Not recorded' : `${lease.renewalOption.noticePeriodMonths} months before expiry`,
        },
        { label: 'Last day for notice', value: deadline && days !== null ? dated(deadline, days) : 'Not worked out' },
        {
          label: 'Renewal option',
          value: lease.renewalOption.exercised ? <StatusDot tone="success">Exercised</StatusDot> : <StatusDot tone="warning">Not exercised</StatusDot>,
        },
      ]
    }
    case 'guarantee_expiry': {
      const guarantee = lease.bankGuarantee
      if (!guarantee) return null
      return [
        { label: 'Guarantee', value: `${guarantee.bank} · ${guarantee.referenceNumber}` },
        { label: 'Amount', value: <CurrencyDisplay amount={guarantee.amount} /> },
        { label: 'Expires', value: dated(guarantee.expiresOn, daysBetween(today, guarantee.expiresOn)) },
      ]
    }
    default:
      return null
  }
}

interface Loaded<T> {
  data: T | null | undefined
  isPending: boolean
}

/** The lease, statement and arrangement the event names, each linked, with who verified it and when. */
function Sources({
  event,
  lease,
  statement,
  arrangement,
  signerOf,
}: {
  event: MonitoringEventListItem
  lease: Loaded<Lease> | null
  statement: Loaded<Statement> | null
  arrangement: Loaded<PaymentArrangement> | null
  signerOf: (userId: string | undefined) => string | undefined
}) {
  const { date: formatDate } = useDateFormatter()
  if (!lease && !statement && !arrangement) {
    return <p className="border-y border-border py-3 text-sm text-muted-foreground">This event names no lease, statement or arrangement.</p>
  }
  const missing = (loaded: Loaded<unknown>, label: string) => (loaded.isPending ? '…' : `${label} not available`)
  return (
    <ul className="divide-y divide-border border-y border-border">
      {lease && event.leaseId ? (
        <SourceRow
          kind="Lease"
          link={recordLink(`/leases/${encodeURIComponent(event.leaseId)}`, lease.data?.reference ?? event.leaseReference ?? missing(lease, 'Lease'))}
          state={
            lease.data ? (
              lease.data.verified ? (
                <SignOff by={signerOf(lease.data.verifiedByUserId)} at={lease.data.verifiedAt} pendingLabel="Terms verified" />
              ) : (
                <SignOff pendingLabel="Terms not verified" />
              )
            ) : null
          }
        />
      ) : null}
      {statement && event.statementId ? (
        <SourceRow
          kind="Statement"
          link={recordLink(
            `/statements/${encodeURIComponent(event.statementId)}`,
            statement.data
              ? statement.data.periodStart && statement.data.periodEnd
                ? `${formatDate(statement.data.periodStart)} – ${formatDate(statement.data.periodEnd)}`
                : statement.data.file.fileName
              : missing(statement, 'Statement'),
          )}
          state={
            statement.data ? (
              statement.data.status === 'verified' ? (
                <SignOff by={signerOf(statement.data.verifiedByUserId)} at={statement.data.verifiedAt} pendingLabel="Figures verified" />
              ) : (
                <StatusBadge status={statement.data.status} />
              )
            ) : null
          }
        />
      ) : null}
      {arrangement && event.arrangementId ? (
        <SourceRow
          kind="Payment arrangement"
          link={recordLink(
            `/arrangements/${encodeURIComponent(event.arrangementId)}`,
            arrangement.data ? <>Agreed {formatDate(arrangement.data.agreedOn)}</> : missing(arrangement, 'Arrangement'),
          )}
          state={arrangement.data ? <StatusBadge status={arrangement.data.status} /> : null}
        />
      ) : null}
    </ul>
  )
}

function SourceRow({ kind, link, state }: { kind: string; link: ReactNode; state: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{kind}</p>
        <p className="text-sm">{link}</p>
      </div>
      {state ? <div className="shrink-0">{state}</div> : null}
    </li>
  )
}
