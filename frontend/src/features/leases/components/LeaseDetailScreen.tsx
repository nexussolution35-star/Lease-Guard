import {
  RENEWAL_DEADLINE_THRESHOLDS,
  daysUntilExpiry,
  daysUntilRenewalDeadline,
  depositCoverage,
  escalationRatePercent,
  escalationSchedule,
  formatZAR,
  guaranteeCoverage,
  guaranteeExpiryStatus,
  isoToday,
  renewalDeadlineStatus,
  renewalNoticeDeadline,
  type Coverage,
  type EscalationScheduleEntry,
  type Lease,
  type LeaseEscalation,
  type MonitoringEvent,
  type RenewalDeadlineStatus,
} from '@leaseguard/domain'
import { BadgeCheck, Info, Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  ConfirmationDialog,
  CurrencyDisplay,
  DataTable,
  DateDisplay,
  EmptyState,
  ErrorState,
  InformationGrid,
  InformationItem,
  LoadingState,
  MetricCard,
  MetricGrid,
  PriorityBadge,
  SectionHeader,
  SignOff,
  StatusBadge,
  StatusDot,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useCompanyProfile } from '@/features/company/api/queries'
import { useMonitoringEventList } from '@/features/monitoring/api/queries'
import { usePropertyQuery } from '@/features/properties/api/queries'
import { useTenantQuery } from '@/features/tenants/api/queries'
import { useUnitQuery } from '@/features/units/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor, type Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useLeaseDocuments, useLeaseQuery, useVerifyLease } from '../api/queries'
import { LeaseFormDialog } from './LeaseFormDialog'
import { LeaseDocuments } from './LeaseDocuments'
import { LeaseTermBars } from './LeaseTermBars'
import { useDateFormatter } from '@/lib/dateFormat'

export interface LeaseDetailScreenProps {
  lease: Lease
}

const EVENTS_SHOWN = 10
/** In the `lg` rail each detail reads as one row, label left and value right, as in a ledger. */
const RAIL_ITEM = 'lg:grid lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-3 lg:space-y-0 lg:[&>dt]:font-normal'
const MONTHS = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

const RENEWAL_DEADLINE_TEXT: Readonly<Record<RenewalDeadlineStatus, { label: string; tone: Tone }>> = {
  not_applicable: { label: 'No notice period recorded', tone: 'neutral' },
  exercised: { label: 'Option exercised', tone: 'success' },
  passed: { label: 'Notice deadline passed', tone: 'danger' },
  due_critical: { label: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.critical} days`, tone: 'danger' },
  due_soon: { label: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.soon} days`, tone: 'warning' },
  upcoming: { label: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.upcoming} days`, tone: 'info' },
  open: { label: 'Open', tone: 'neutral' },
}

const interval = (escalation: LeaseEscalation) => (escalation.frequency === 'biennial' ? 'every two years' : 'every year')

/** The escalation clause in words. The rate comes from `escalationRatePercent`, never worked out here. */
function describeEscalation(escalation: LeaseEscalation, formatDate: (iso: string) => string): string {
  const from = `from ${formatDate(escalation.firstEscalationDate)}`
  switch (escalation.type) {
    case 'percentage':
      return `${MONTHS.format(escalationRatePercent(escalation))}% ${interval(escalation)} ${from}`
    case 'fixed_amount':
      return `${formatZAR(escalation.fixedAmount ?? 0)} ${interval(escalation)} ${from}`
    case 'cpi_linked':
      return `CPI-linked, ${MONTHS.format(escalationRatePercent(escalation))}% ${interval(escalation)} ${from} (assumed CPI ${MONTHS.format(escalation.cpiAssumedPercentage ?? 0)}% plus ${MONTHS.format(escalation.cpiMarginPercentage ?? 0)}%)`
    case 'none':
      return 'No escalation clause'
  }
}

const SCHEDULE_COLUMNS: DataTableColumn<EscalationScheduleEntry>[] = [
  {
    id: 'effectiveDate',
    header: 'From',
    cell: (row) => (
      <span className="tabular-nums">
        <DateDisplay value={row.effectiveDate} />
        {row.step === 0 ? <span className="block text-xs text-muted-foreground">Commencement</span> : null}
      </span>
    ),
  },
  { id: 'rental', header: 'Monthly rental', align: 'right', cell: (row) => <CurrencyDisplay amount={row.monthlyRental} /> },
  {
    id: 'increase',
    header: 'Increase',
    align: 'right',
    hideBelow: 'sm',
    cell: (row) => (row.step === 0 ? <span className="text-muted-foreground">—</span> : <CurrencyDisplay amount={row.increase} signed />),
  },
  {
    id: 'state',
    header: 'State',
    cell: (row) =>
      row.current ? <StatusDot tone="success">In force</StatusDot> : row.applied ? <StatusDot tone="neutral">Applied</StatusDot> : <StatusDot tone="info">Upcoming</StatusDot>,
  },
]

/** Required against held cover, from the domain coverage rule. */
function CoverageItems({ coverage, heldLabel }: { coverage: Coverage; heldLabel: string }) {
  return (
    <>
      <InformationItem label={heldLabel} value={<CurrencyDisplay amount={coverage.actual} />} />
      <InformationItem
        label="Required today"
        hint="Basis months × the monthly rental expected today under the escalation clause."
        value={
          <span className="tabular-nums">
            <CurrencyDisplay amount={coverage.required} />
            <span className="text-muted-foreground"> · {MONTHS.format(coverage.basisMonths)} months</span>
          </span>
        }
      />
      <InformationItem
        label="Cover"
        value={
          coverage.shortfall > 0 ? (
            <StatusDot tone="danger">
              <span className="tabular-nums">Short by {formatZAR(coverage.shortfall)} ({MONTHS.format(coverage.coverageMonths)} months held)</span>
            </StatusDot>
          ) : (
            <StatusDot tone="success">
              <span className="tabular-nums">Covered ({MONTHS.format(coverage.coverageMonths)} months held)</span>
            </StatusDot>
          )
        }
      />
    </>
  )
}

/**
 * One lease: who verified its terms (or that they still wait on a person, and are not used for financial monitoring
 * until then), headline figures, the term drawn to scale with the renewal-notice deadline, the escalation schedule,
 * deposit and guarantee coverage, the lease's monitoring events and documents, and its parties and dates in a side
 * rail. Every calculation comes from `@leaseguard/domain`; verification is recorded by the API and the database.
 */
export function LeaseDetailScreen({ lease }: LeaseDetailScreenProps) {
  const { date: formatDate } = useDateFormatter()
  const isWriter = useIsCompanyWriter()
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const verify = useVerifyLease()
  // The South African date when the screen opened; every term figure below is worked out as of this day.
  const [today] = useState(() => isoToday(new Date()))

  const tenant = useTenantQuery(lease.tenantId)
  const property = usePropertyQuery(lease.propertyId)
  const unit = useUnitQuery(lease.unitId)
  const previous = useLeaseQueryForLink(lease.previousLeaseId)
  const company = useCompanyProfile()
  const documents = useLeaseDocuments(lease.id)
  const openEvents = useMonitoringEventList({ page: 1, pageSize: 1, leaseId: lease.id, open: true })
  const events = useMonitoringEventList({ page: 1, pageSize: EVENTS_SHOWN, leaseId: lease.id, sort: 'identifiedOn', direction: 'desc' })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })

  /** A member's name only when it is loaded: a sign-off never shows a placeholder as if it were a person. */
  const signerOf = (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined
  /** For plain text (an uploader): says why a name is missing instead of leaving a gap. */
  const nameOf = (userId: string) => {
    const name = signerOf(userId)
    if (name) return name
    if (members.isPending) return '…'
    return members.isSuccess && members.data.total <= members.data.items.length ? 'Former member' : 'Not available'
  }

  const schedule = escalationSchedule(lease, today)
  const rentalToday = schedule.find((row) => row.current)?.monthlyRental
  const expiryDays = daysUntilExpiry(lease, today)
  const deadline = renewalNoticeDeadline(lease)
  const deadlineDays = daysUntilRenewalDeadline(lease, today)
  const deadlineText = RENEWAL_DEADLINE_TEXT[renewalDeadlineStatus(lease, today)]
  const deposit = depositCoverage(lease, today)
  const guarantee = guaranteeCoverage(lease, today)
  const guaranteeNoticeDays = company.data?.settings.guaranteeExpiryNoticeDays
  const guaranteeState =
    lease.bankGuarantee && guaranteeNoticeDays ? guaranteeExpiryStatus(lease.bankGuarantee, today, guaranteeNoticeDays) : null
  const verifier = signerOf(lease.verifiedByUserId)

  async function confirmVerify() {
    try {
      const saved = await verify.mutateAsync(lease.id)
      toast.success(`Terms of ${saved.reference} verified`)
    } catch (error) {
      toast.error('The terms were not verified', { description: describeApiError(error, 'Try again in a moment.') })
      throw error
    }
  }

  const tenantName = tenant.data?.tradingName
  const eventColumns: DataTableColumn<MonitoringEvent>[] = [
    {
      id: 'title',
      header: 'Event',
      className: 'min-w-56 whitespace-normal',
      cell: (event) => (
        <>
          <AppLink to={`/monitoring/${encodeURIComponent(event.id)}`} className="font-medium text-foreground hover:underline">
            {event.title}
          </AppLink>
          <span className="block text-xs text-muted-foreground">{labelFor(event.type)}</span>
        </>
      ),
    },
    { id: 'priority', header: 'Priority', hideBelow: 'sm', cell: (event) => <PriorityBadge priority={event.priority} /> },
    { id: 'status', header: 'Status', cell: (event) => <StatusBadge status={event.status} /> },
    {
      id: 'signOff',
      header: 'Sign-off',
      hideBelow: 'md',
      cell: (event) =>
        event.resolvedAt ? (
          <SignOff by={signerOf(event.resolvedByUserId)} at={event.resolvedAt} pendingLabel="Closed" />
        ) : (
          <SignOff pendingLabel="Awaiting review" at={event.identifiedOn} />
        ),
    },
  ]

  return (
    <section>
      <PageHeader
        title={lease.reference}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{lease.reference}</span>
            {tenantName ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{tenantName}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <StatusBadge status={lease.status} />
          </p>
        }
        actions={
          isWriter ? (
            <>
              {/* One primary action: verifying while the terms wait on a person, editing once they are verified. */}
              <Button type="button" variant={lease.verified ? 'default' : 'outline'} onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              {!lease.verified ? (
                <Button type="button" onClick={() => setConfirming(true)}>
                  <BadgeCheck aria-hidden="true" />
                  Verify terms
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {!lease.verified ? (
        <p role="note" className="mb-6 flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            These terms are not verified, so this lease is not used for financial monitoring: no escalation, expiry, renewal,
            deposit or guarantee events are raised from it until{' '}
            {isWriter ? 'you or another authorised person verify' : 'a company admin or property manager verifies'} the terms
            against the signed lease. The figures below are worked out from the terms as captured.
          </span>
        </p>
      ) : null}

      {/* DOM order is the phone order: figures, then the work, then details; from `lg` the details move into a right rail. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <MetricGrid className="lg:col-start-1 lg:row-start-1 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <MetricCard
            lead
            label="Monthly rental today"
            value={<CurrencyDisplay amount={rentalToday} />}
            description={lease.escalation.type === 'none' ? 'No escalation clause' : 'Under the escalation clause'}
          />
          <MetricCard
            label={expiryDays < 0 ? 'Expired' : 'Days to expiry'}
            value={<span className="tabular-nums">{expiryDays < 0 ? formatDate(lease.expiryDate) : expiryDays}</span>}
            {...(expiryDays < 0 ? {} : { description: formatDate(lease.expiryDate) })}
          />
          <MetricCard
            label="Open monitoring events"
            value={openEvents.data?.total ?? '—'}
            tone={(openEvents.data?.total ?? 0) > 0 ? 'warning' : 'neutral'}
            isLoading={openEvents.isPending && !openEvents.isError}
          />
          <MetricCard label="Documents" value={documents.data?.length ?? '—'} isLoading={documents.isPending && !documents.isError} />
        </MetricGrid>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
          <section aria-label="Verification" className="space-y-3">
            <SectionHeader
              title="Verification"
              description={
                lease.verified
                  ? 'The terms were checked against the signed lease and drive financial monitoring.'
                  : 'An authorised person checks the terms against the signed lease before they drive financial monitoring.'
              }
            />
            <div className="border-y border-border py-3">
              {lease.verified ? (
                verifier ? (
                  <SignOff by={verifier} at={lease.verifiedAt} />
                ) : (
                  <span className="text-sm text-foreground">
                    Terms verified
                    {lease.verifiedAt ? (
                      <>
                        <span className="text-muted-foreground"> · </span>
                        <DateDisplay value={lease.verifiedAt} className="text-muted-foreground tabular-nums" />
                      </>
                    ) : null}
                  </span>
                )
              ) : (
                <SignOff pendingLabel="Terms not verified" />
              )}
            </div>
          </section>

          <section aria-label="Term and renewal" className="space-y-3">
            <SectionHeader title="Term and renewal" />
            <div className="rounded-lg border border-border px-4 pt-4 pb-3">
              <LeaseTermBars leases={[lease]} today={today} />
            </div>
            <InformationGrid columns={2} className="gap-y-3">
              <InformationItem
                label="Renewal option"
                value={
                  lease.renewalOption.exists
                    ? lease.renewalOption.renewalTermMonths
                      ? `${lease.renewalOption.renewalTermMonths} months`
                      : 'Yes, term not recorded'
                    : 'No renewal option'
                }
              />
              {lease.renewalOption.exists ? (
                <>
                  <InformationItem
                    label="Notice period"
                    value={lease.renewalOption.noticePeriodMonths === undefined ? undefined : `${lease.renewalOption.noticePeriodMonths} months before expiry`}
                  />
                  <InformationItem
                    label="Last day for notice"
                    value={
                      deadline ? (
                        <span className="tabular-nums">
                          <DateDisplay value={deadline} />
                          {deadlineDays !== null && deadlineDays >= 0 && !lease.renewalOption.exercised ? (
                            <span className="text-muted-foreground"> · {deadlineDays} days left</span>
                          ) : null}
                        </span>
                      ) : undefined
                    }
                  />
                  <InformationItem
                    label="Notice"
                    value={
                      <StatusDot tone={deadlineText.tone}>
                        {deadlineText.label}
                        {lease.renewalOption.exercised && lease.renewalOption.exercisedOn ? (
                          <span className="text-muted-foreground tabular-nums"> · {formatDate(lease.renewalOption.exercisedOn)}</span>
                        ) : null}
                      </StatusDot>
                    }
                  />
                </>
              ) : null}
              {lease.renewalOption.notes ? <InformationItem label="Renewal notes" value={lease.renewalOption.notes} className="sm:col-span-2" /> : null}
            </InformationGrid>
          </section>

          <section aria-label="Escalation schedule" className="space-y-3">
            <SectionHeader title="Escalation schedule" description={describeEscalation(lease.escalation, formatDate)} />
            <DataTable caption={`Escalation schedule of ${lease.reference}`} columns={SCHEDULE_COLUMNS} rows={schedule} getRowId={(row) => String(row.step)} />
          </section>

          <section aria-label="Deposit and guarantee" className="space-y-3">
            <SectionHeader title="Deposit and guarantee" description="Cover held against the rental expected today." />
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Deposit</h3>
                {lease.deposit ? (
                  <InformationGrid columns={1} className="gap-y-3">
                    {deposit ? (
                      <CoverageItems coverage={deposit} heldLabel="Held" />
                    ) : (
                      <InformationItem label="Held" value={<CurrencyDisplay amount={lease.deposit.amount} />} />
                    )}
                    <InformationItem label="Held by" value={labelFor(lease.deposit.heldBy)} />
                    <InformationItem label="Received" value={lease.deposit.receivedOn ? <DateDisplay value={lease.deposit.receivedOn} className="tabular-nums" /> : undefined} />
                    <InformationItem label="Interest-bearing" value={lease.deposit.interestBearing ? 'Yes' : 'No'} />
                    {!deposit ? <InformationItem label="Cover" value="No basis in months recorded, so cover is not worked out" /> : null}
                  </InformationGrid>
                ) : (
                  <p className="text-sm text-muted-foreground">No deposit recorded.</p>
                )}
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Bank guarantee</h3>
                {lease.bankGuarantee && guarantee ? (
                  <InformationGrid columns={1} className="gap-y-3">
                    <CoverageItems coverage={guarantee} heldLabel="Guaranteed" />
                    <InformationItem label="Bank" value={`${lease.bankGuarantee.bank} · ${lease.bankGuarantee.referenceNumber}`} />
                    <InformationItem
                      label="Expires"
                      value={
                        <span className="tabular-nums">
                          <DateDisplay value={lease.bankGuarantee.expiresOn} />
                          <span className="text-muted-foreground"> · </span>
                          {guaranteeState ? <StatusBadge status={guaranteeState.state} /> : <StatusBadge status={lease.bankGuarantee.status} />}
                        </span>
                      }
                    />
                  </InformationGrid>
                ) : (
                  <p className="text-sm text-muted-foreground">No bank guarantee recorded.</p>
                )}
              </div>
            </div>
          </section>

          <section aria-label="Monitoring events" className="space-y-3">
            <SectionHeader
              title="Monitoring events"
              description={
                events.data && events.data.total > EVENTS_SHOWN
                  ? `The latest ${EVENTS_SHOWN} of ${events.data.total} events raised for this lease.`
                  : 'Discrepancies and upcoming obligations raised for this lease.'
              }
            />
            {events.isPending ? (
              <LoadingState label="Loading the monitoring events…" rows={2} />
            ) : events.isError ? (
              <ErrorState title="Could not load the monitoring events" error={describeApiError(events.error, 'Try again in a moment.')} onRetry={() => void events.refetch()} />
            ) : events.data.total === 0 ? (
              <EmptyState
                title="No monitoring events"
                description={lease.verified ? 'Nothing has been raised for this lease.' : 'Events are raised once the terms are verified.'}
                className="py-0"
              />
            ) : (
              <DataTable caption={`Monitoring events of ${lease.reference}`} columns={eventColumns} rows={events.data.items} getRowId={(event) => event.id} />
            )}
          </section>

          <LeaseDocuments leaseId={lease.id} leaseReference={lease.reference} canUpload={isWriter} nameOf={nameOf} />
        </div>

        <section aria-label="Details" className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
            <InformationItem
              label="Tenant"
              className={RAIL_ITEM}
              value={
                <AppLink to={`/tenants/${encodeURIComponent(lease.tenantId)}`} className="text-foreground hover:underline">
                  {tenantName ?? (tenant.isPending ? '…' : 'Tenant')}
                </AppLink>
              }
            />
            <InformationItem
              label="Property"
              className={RAIL_ITEM}
              value={
                <AppLink to={`/properties/${encodeURIComponent(lease.propertyId)}`} className="text-foreground hover:underline">
                  {property.data?.name ?? (property.isPending ? '…' : 'Property')}
                </AppLink>
              }
            />
            <InformationItem
              label="Unit"
              className={RAIL_ITEM}
              value={
                <AppLink to={`/units/${encodeURIComponent(lease.unitId)}`} className="text-foreground tabular-nums hover:underline">
                  {unit.data?.unitNumber ?? (unit.isPending ? '…' : 'Unit')}
                </AppLink>
              }
            />
            <InformationItem label="Commences" className={RAIL_ITEM} value={<DateDisplay value={lease.commencementDate} className="tabular-nums" />} />
            <InformationItem label="Expires" className={RAIL_ITEM} value={<DateDisplay value={lease.expiryDate} className="tabular-nums" />} />
            <InformationItem label="Initial rental" className={RAIL_ITEM} value={<CurrencyDisplay amount={lease.initialMonthlyRental} />} />
            <InformationItem
              label="Recorded rental"
              hint="The current monthly rental as captured on the lease record, excluding VAT."
              className={RAIL_ITEM}
              value={<CurrencyDisplay amount={lease.currentMonthlyRental} />}
            />
            <InformationItem label="Rental due" className={RAIL_ITEM} value={`Day ${lease.paymentDueDay} of each month`} />
            {lease.previousLeaseId ? (
              <InformationItem
                label="Renews"
                className={RAIL_ITEM}
                value={
                  <AppLink to={`/leases/${encodeURIComponent(lease.previousLeaseId)}`} className="text-foreground tabular-nums hover:underline">
                    {previous.data?.reference ?? 'Previous lease'}
                  </AppLink>
                }
              />
            ) : null}
            <InformationItem label="Added" className={RAIL_ITEM} value={<DateDisplay value={lease.createdAt} className="tabular-nums" />} />
            <InformationItem label="Notes" className={cn(RAIL_ITEM, 'sm:col-span-2 lg:col-span-1')} value={lease.notes} />
          </InformationGrid>
        </section>
      </div>

      {isWriter ? <LeaseFormDialog open={editing} onOpenChange={setEditing} lease={lease} /> : null}
      {isWriter && !lease.verified ? (
        <ConfirmationDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Verify the terms of ${lease.reference}?`}
          description="Confirm you have checked these terms against the signed lease. Once verified they drive financial monitoring (escalation checks, expiry and renewal deadlines, deposit and guarantee cover), and your name and the time are recorded."
          confirmLabel="Verify terms"
          onConfirm={confirmVerify}
          isPending={verify.isPending}
        />
      ) : null}
    </section>
  )
}

/** The lease this one renewed, for its reference in the details; nothing is requested when there is none. */
function useLeaseQueryForLink(leaseId: string | undefined) {
  return useLeaseQuery(leaseId ?? '', { enabled: leaseId !== undefined })
}
