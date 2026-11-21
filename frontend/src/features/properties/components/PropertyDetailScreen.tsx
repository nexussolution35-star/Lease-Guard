import { isoToday, type Lease, type MonitoringEvent, type Property, type Unit, renewalNoticeDeadline } from '@leaseguard/domain'
import { Archive, ArchiveRestore, FileUp, Info, Pencil, Plus } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  ConfirmationDialog,
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
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useLeaseList } from '@/features/leases/api/queries'
import { LeaseTermBars } from '@/features/leases/components/LeaseTermBars'
import { LeaseVerification } from '@/features/leases/components/LeaseVerification'
import { useMonitoringEventList } from '@/features/monitoring/api/queries'
import { useUnitList } from '@/features/units/api/queries'
import { UnitFormDialog } from '@/features/units/components/UnitFormDialog'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useArchiveProperty, useRestoreProperty } from '../api/queries'
import { PropertyFormDialog } from './PropertyFormDialog'

export interface PropertyDetailScreenProps {
  property: Property
}

const UNITS_SHOWN = 25
const EVENTS_SHOWN = 10
const LEASES_SHOWN = 25
const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })
const area = (squareMetres: number) => `${AREA_FORMAT.format(squareMetres)} m²`
/** In the `lg` rail each detail reads as one row, label left and value right, as in a ledger. */
const RAIL_ITEM = 'lg:grid lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-3 lg:space-y-0 lg:[&>dt]:font-normal'

const UNIT_COLUMNS: DataTableColumn<Unit>[] = [
  {
    id: 'unitNumber',
    header: 'Unit',
    cell: (unit) => (
      <AppLink to={`/units/${encodeURIComponent(unit.id)}`} className="font-medium text-foreground hover:underline">
        {unit.unitNumber}
      </AppLink>
    ),
  },
  { id: 'type', header: 'Type', hideBelow: 'sm', cell: (unit) => labelFor(unit.type) },
  { id: 'floorArea', header: 'Floor area', align: 'right', hideBelow: 'md', cell: (unit) => <span className="tabular-nums">{area(unit.floorAreaSqm)}</span> },
  { id: 'occupancy', header: 'Occupancy', cell: (unit) => <StatusBadge status={unit.occupancyStatus} /> },
]

const EVENT_COLUMNS: DataTableColumn<MonitoringEvent>[] = [
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
        {/* The Sign-off column is hidden on phones, so the mark moves under the title there. */}
        <SignOff pendingLabel="Awaiting review" at={event.identifiedOn} className="mt-1.5 sm:hidden" />
      </>
    ),
  },
  { id: 'priority', header: 'Priority', cell: (event) => <PriorityBadge priority={event.priority} /> },
  { id: 'status', header: 'Status', hideBelow: 'sm', cell: (event) => <StatusBadge status={event.status} /> },
  { id: 'dueDate', header: 'Due', hideBelow: 'md', cell: (event) => <DateDisplay value={event.dueDate} className="tabular-nums" /> },
  {
    id: 'signOff',
    header: 'Sign-off',
    hideBelow: 'sm',
    // Open events are unresolved by definition: nobody has signed them off yet. The date is when the event was raised.
    cell: (event) => <SignOff pendingLabel="Awaiting review" at={event.identifiedOn} />,
  },
]

/** Counts for the stat strip: one row each, the total is what matters. */
function usePropertyCounts(propertyId: string) {
  const one = { page: 1, pageSize: 1 }
  const units = useUnitList({ ...one, propertyId })
  const occupied = useUnitList({ ...one, propertyId, occupancyStatus: 'occupied' })
  const openEvents = useMonitoringEventList({ ...one, propertyId, open: true })
  return { units, occupied, openEvents }
}

/**
 * The property's current leases for the term bars: active ones (their total is also the "Active leases" figure) and
 * those flagged as expiring, which are the ones whose renewal notice matters most.
 */
function usePropertyLeases(propertyId: string) {
  const params = { page: 1, pageSize: LEASES_SHOWN, propertyId, sort: 'commencementDate', direction: 'asc' } as const
  const active = useLeaseList({ ...params, status: 'active' })
  const expiring = useLeaseList({ ...params, status: 'expiring' })
  const leases: Lease[] = [...(active.data?.items ?? []), ...(expiring.data?.items ?? [])]
  return {
    active,
    leases,
    total: (active.data?.total ?? 0) + (expiring.data?.total ?? 0),
    isPending: active.isPending || expiring.isPending,
    error: active.error ?? expiring.error,
    refetch: () => Promise.all([active.refetch(), expiring.refetch()]),
  }
}

/**
 * One property: headline counts led by its open monitoring events, the events that still need attention (each awaiting
 * review), its units, its current lease terms drawn to scale with who verified them, and its details in a side rail. Writers edit, archive and restore it; an archived property is
 * read-only until restored. Every rule is enforced by the API; the screen explains it.
 */
export function PropertyDetailScreen({ property }: PropertyDetailScreenProps) {
  const isWriter = useIsCompanyWriter()
  const isArchived = property.status === 'archived'
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [confirming, setConfirming] = useState<'archive' | 'restore' | null>(null)
  const archive = useArchiveProperty()
  const restore = useRestoreProperty()

  const counts = usePropertyCounts(property.id)
  const leases = usePropertyLeases(property.id)
  const today = isoToday(new Date())
  const units = useUnitList({ page: 1, pageSize: UNITS_SHOWN, propertyId: property.id, sort: 'unitNumber', direction: 'asc' })
  const events = useMonitoringEventList({ page: 1, pageSize: EVENTS_SHOWN, propertyId: property.id, open: true, sort: 'priority', direction: 'desc' })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  /**
   * A member's name. The manager and owner are always members (database rule), so "Former member" is only said when
   * the complete member list loaded without them; while loading, on an error or past the first page it is unknown.
   */
  const nameOf = (userId: string | undefined) => {
    if (!userId) return undefined
    const name = members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName
    if (name) return name
    if (members.isPending) return '…'
    return members.isSuccess && members.data.total <= members.data.items.length ? 'Former member' : 'Not available'
  }
  /** A member's name only when it is loaded: a sign-off never shows a placeholder as if it were a person. */
  const signerOf = (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined

  async function confirmStatusChange() {
    const action = confirming
    if (!action) return
    try {
      const saved = action === 'archive' ? await archive.mutateAsync(property.id) : await restore.mutateAsync(property.id)
      toast.success(action === 'archive' ? `${saved.name} archived` : `${saved.name} restored`)
    } catch (error) {
      toast.error(action === 'archive' ? 'The property was not archived' : 'The property was not restored', {
        description: describeApiError(error, 'Try again in a moment.'),
      })
      throw error
    }
  }

  const actions = isWriter ? (
    isArchived ? (
      <Button type="button" variant="outline" onClick={() => setConfirming('restore')}>
        <ArchiveRestore aria-hidden="true" />
        Restore
      </Button>
    ) : (
      <>
        <Button type="button" variant="outline" onClick={() => setConfirming('archive')}>
          <Archive aria-hidden="true" />
          Archive
        </Button>
        <Button type="button" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </>
    )
  ) : null

  const total = (query: { data?: { total: number } }) => query.data?.total ?? '—'
  const loading = (query: { isPending: boolean; isError: boolean }) => query.isPending && !query.isError

  const openEvents = counts.openEvents.data?.total ?? 0

  return (
    <section>
      <PageHeader
        title={property.name}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{property.code}</span>
            <span aria-hidden="true">·</span>
            <span>{labelFor(property.type)}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={property.status} />
          </p>
        }
        actions={actions}
      />

      {isArchived ? (
        <p className="mb-6 flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This property is archived. Its history is kept, and it cannot be changed until it is restored.
        </p>
      ) : null}

      {/*
        DOM order is the phone order: figures, then the work (open events lead), then details (owner decision,
        20 Nov 2026: what needs attention comes first). From `lg` the details move into a right rail beside both.
      */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <MetricGrid className="lg:col-start-1 lg:row-start-1 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <MetricCard
            lead
            label="Open monitoring events"
            value={total(counts.openEvents)}
            tone={openEvents > 0 ? 'warning' : 'neutral'}
            {...(openEvents > 0 ? { description: 'Needs attention' } : {})}
            isLoading={loading(counts.openEvents)}
          />
          <MetricCard label="Units" value={total(counts.units)} isLoading={loading(counts.units)} />
          <MetricCard label="Occupied units" value={total(counts.occupied)} isLoading={loading(counts.occupied)} />
          <MetricCard label="Active leases" value={total(leases.active)} isLoading={loading(leases.active)} />
        </MetricGrid>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
          <section aria-label="Open monitoring events" className="space-y-3">
            <SectionHeader
              title="Open monitoring events"
              description={
                events.data && events.data.total > EVENTS_SHOWN
                  ? `The ${EVENTS_SHOWN} highest-priority of ${events.data.total} events that still need attention.`
                  : 'Discrepancies and upcoming obligations at this property that still need attention.'
              }
            />
            {events.isPending ? (
              <LoadingState label="Loading the monitoring events…" />
            ) : events.isError ? (
              <ErrorState title="Could not load the monitoring events" error={describeApiError(events.error, 'Try again in a moment.')} onRetry={() => void events.refetch()} />
            ) : events.data.total === 0 ? (
              <EmptyState title="Nothing needs attention" description="No open monitoring events at this property." className="py-0" />
            ) : (
              <DataTable caption={`Open monitoring events at ${property.name}`} columns={EVENT_COLUMNS} rows={events.data.items} getRowId={(event) => event.id} />
            )}
          </section>

          <section aria-label="Units" className="space-y-3">
            <SectionHeader
              title="Units"
              description={units.data && units.data.total > UNITS_SHOWN ? `The first ${UNITS_SHOWN} of ${units.data.total} units, by unit number.` : undefined}
              actions={
                isWriter && !isArchived ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAddingUnit(true)}>
                      <Plus aria-hidden="true" />
                      Add unit
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/properties/import" search={{ propertyId: property.id }}>
                        <FileUp aria-hidden="true" />
                        Import from file
                      </Link>
                    </Button>
                  </>
                ) : undefined
              }
            />
            {units.isPending ? (
              <LoadingState label="Loading the units…" />
            ) : units.isError ? (
              <ErrorState title="Could not load the units" error={describeApiError(units.error, 'Try again in a moment.')} onRetry={() => void units.refetch()} />
            ) : units.data.total === 0 ? (
              <EmptyState title="No units yet" description="Units added to this property appear here." className="py-0" />
            ) : (
              <DataTable caption={`Units in ${property.name}`} columns={UNIT_COLUMNS} rows={units.data.items} getRowId={(unit) => unit.id} />
            )}
          </section>

          <section aria-label="Lease terms" className="space-y-3">
            <SectionHeader
              title="Lease terms"
              description={
                leases.total > leases.leases.length
                  ? `The first ${leases.leases.length} of ${leases.total} active and expiring leases, by commencement date.`
                  : leases.leases.some((lease) => renewalNoticeDeadline(lease) !== null)
                    ? 'Active and expiring leases at this property, with the last day for renewal notice.'
                    : 'Active and expiring leases at this property.'
              }
            />
            {leases.isPending ? (
              <LoadingState label="Loading the lease terms…" rows={2} />
            ) : leases.error ? (
              <ErrorState title="Could not load the leases" error={describeApiError(leases.error, 'Try again in a moment.')} onRetry={() => void leases.refetch()} />
            ) : leases.leases.length === 0 ? (
              <EmptyState title="No active leases" description="Active and expiring leases at this property appear here, drawn to scale." className="py-0" />
            ) : (
              <div className="rounded-lg border border-border px-4 pt-4 pb-3">
                <LeaseTermBars leases={leases.leases} today={today} />
                <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Terms verified by</p>
                <dl aria-label="Lease verification" className="divide-y divide-border/70">
                  {leases.leases.map((lease) => (
                    <div key={lease.id} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 py-2 text-sm">
                      <dt className="truncate font-medium tabular-nums">
                        <AppLink to={`/leases/${encodeURIComponent(lease.id)}`} className="text-foreground hover:underline">
                          {lease.reference}
                        </AppLink>
                      </dt>
                      <dd className="min-w-0">
                        <LeaseVerification lease={lease} signer={signerOf(lease.verifiedByUserId)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        </div>

        <section
          aria-label="Details"
          className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-8"
        >
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
            <InformationItem label="Gross lettable area" value={<span className="tabular-nums">{area(property.grossLettableAreaSqm)}</span>} className={RAIL_ITEM} />
            <InformationItem
              label="Address"
              className={RAIL_ITEM}
              value={
                <address className="not-italic">
                  {[property.address.line1, property.address.line2, property.address.suburb, property.address.city, `${property.address.province} ${property.address.postalCode}`]
                    .filter((line): line is string => Boolean(line))
                    .map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                </address>
              }
            />
            <InformationItem label="Property manager" value={nameOf(property.managerUserId)} className={RAIL_ITEM} />
            <InformationItem label="Property owner" value={nameOf(property.ownerUserId)} className={RAIL_ITEM} />
            <InformationItem label="Accounting system" value={property.accountingSystem === 'other' ? 'Other' : property.accountingSystem} className={RAIL_ITEM} />
            <InformationItem label="Added" value={<DateDisplay value={property.createdAt} className="tabular-nums" />} className={RAIL_ITEM} />
            <InformationItem label="Description" value={property.description} className={cn(RAIL_ITEM, 'sm:col-span-2 lg:col-span-1')} />
          </InformationGrid>
        </section>
      </div>

      {isWriter && !isArchived ? <PropertyFormDialog open={editing} onOpenChange={setEditing} property={property} /> : null}
      {isWriter && !isArchived ? (
        <UnitFormDialog
          open={addingUnit}
          onOpenChange={setAddingUnit}
          property={property}
          onSaved={(unit) => void navigate({ to: '/units/$unitId', params: { unitId: unit.id } })}
        />
      ) : null}
      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        title={confirming === 'restore' ? `Restore ${property.name}?` : `Archive ${property.name}?`}
        description={
          confirming === 'restore'
            ? 'The property becomes active again and can be changed.'
            : 'The property and its history are kept, but it becomes read-only until it is restored. A property with leases that have not ended cannot be archived.'
        }
        confirmLabel={confirming === 'restore' ? 'Restore property' : 'Archive property'}
        destructive={confirming === 'archive'}
        onConfirm={confirmStatusChange}
        isPending={archive.isPending || restore.isPending}
      />
    </section>
  )
}
