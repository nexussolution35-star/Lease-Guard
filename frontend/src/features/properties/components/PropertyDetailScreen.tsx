import type { MonitoringEvent, Property, Unit } from '@leaseguard/domain'
import { Archive, ArchiveRestore, BellRing, DoorOpen, FileText, Info, Pencil, Users } from 'lucide-react'
import { useId, useState } from 'react'
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
  StatusBadge,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useLeaseList } from '@/features/leases/api/queries'
import { useMonitoringEventList } from '@/features/monitoring/api/queries'
import { useUnitList } from '@/features/units/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import { useArchiveProperty, useRestoreProperty } from '../api/queries'
import { PropertyFormDialog } from './PropertyFormDialog'

export interface PropertyDetailScreenProps {
  property: Property
}

const UNITS_SHOWN = 25
const EVENTS_SHOWN = 10
const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })
const area = (squareMetres: number) => `${AREA_FORMAT.format(squareMetres)} m²`

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
      </>
    ),
  },
  { id: 'priority', header: 'Priority', cell: (event) => <PriorityBadge priority={event.priority} /> },
  { id: 'status', header: 'Status', hideBelow: 'sm', cell: (event) => <StatusBadge status={event.status} /> },
  { id: 'dueDate', header: 'Due', hideBelow: 'md', cell: (event) => <DateDisplay value={event.dueDate} /> },
]

/** Counts for the headline cards: one row each, the total is what matters. */
function usePropertyCounts(propertyId: string) {
  const one = { page: 1, pageSize: 1 }
  const units = useUnitList({ ...one, propertyId })
  const occupied = useUnitList({ ...one, propertyId, occupancyStatus: 'occupied' })
  const activeLeases = useLeaseList({ ...one, propertyId, status: 'active' })
  const openEvents = useMonitoringEventList({ ...one, propertyId, open: true })
  return { units, occupied, activeLeases, openEvents }
}

/**
 * One property: its details, headline counts (units, occupancy, active leases, open monitoring events), its units and
 * the monitoring events that still need attention. Writers edit, archive and restore it; an archived property is
 * read-only until restored. Every rule is enforced by the API; the screen explains it.
 */
export function PropertyDetailScreen({ property }: PropertyDetailScreenProps) {
  const isWriter = useIsCompanyWriter()
  const isArchived = property.status === 'archived'
  const detailsId = useId()
  const unitsId = useId()
  const eventsId = useId()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState<'archive' | 'restore' | null>(null)
  const archive = useArchiveProperty()
  const restore = useRestoreProperty()

  const counts = usePropertyCounts(property.id)
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
        <Button type="button" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button type="button" variant="outline" onClick={() => setConfirming('archive')}>
          <Archive aria-hidden="true" />
          Archive
        </Button>
      </>
    )
  ) : null

  const total = (query: { data?: { total: number } }) => query.data?.total ?? '—'
  const loading = (query: { isPending: boolean; isError: boolean }) => query.isPending && !query.isError

  return (
    <section className="space-y-6">
      <PageHeader
        title={property.name}
        description={`${property.code} · ${labelFor(property.type)} · ${property.address.city}, ${property.address.province}`}
        status={<StatusBadge status={property.status} />}
        actions={actions}
        className="pb-0"
      />

      {isArchived ? (
        <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This property is archived. Its history is kept, and it cannot be changed until it is restored.
        </p>
      ) : null}

      <MetricGrid>
        <MetricCard label="Units" value={total(counts.units)} icon={DoorOpen} isLoading={loading(counts.units)} />
        <MetricCard label="Occupied units" value={total(counts.occupied)} icon={Users} isLoading={loading(counts.occupied)} />
        <MetricCard label="Active leases" value={total(counts.activeLeases)} icon={FileText} isLoading={loading(counts.activeLeases)} />
        <MetricCard
          label="Open monitoring events"
          value={total(counts.openEvents)}
          icon={BellRing}
          tone={(counts.openEvents.data?.total ?? 0) > 0 ? 'warning' : 'neutral'}
          isLoading={loading(counts.openEvents)}
        />
      </MetricGrid>

      <Card role="region" aria-labelledby={detailsId}>
        <CardHeader>
          <CardTitle id={detailsId} className="text-base">
            Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InformationGrid columns={3}>
            <InformationItem label="Code" value={<span className="font-mono">{property.code}</span>} hint="Used in lease references; fixed once the property exists." />
            <InformationItem label="Type" value={labelFor(property.type)} />
            <InformationItem label="Gross lettable area" value={area(property.grossLettableAreaSqm)} />
            <InformationItem
              label="Address"
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
            <InformationItem label="Property manager" value={nameOf(property.managerUserId)} />
            <InformationItem label="Property owner" value={nameOf(property.ownerUserId)} />
            <InformationItem label="Accounting system" value={property.accountingSystem === 'other' ? 'Other' : property.accountingSystem} />
            <InformationItem label="Added" value={<DateDisplay value={property.createdAt} />} />
            <InformationItem label="Description" value={property.description} className="sm:col-span-2 lg:col-span-3" />
          </InformationGrid>
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby={unitsId}>
        <CardHeader>
          <CardTitle id={unitsId} className="text-base">
            Units
          </CardTitle>
          <CardDescription>
            {units.data && units.data.total > UNITS_SHOWN ? `The first ${UNITS_SHOWN} of ${units.data.total} units, by unit number.` : 'Units in this property.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {units.isPending ? (
            <LoadingState label="Loading the units…" />
          ) : units.isError ? (
            <ErrorState title="Could not load the units" error={describeApiError(units.error, 'Try again in a moment.')} onRetry={() => void units.refetch()} />
          ) : units.data.total === 0 ? (
            <EmptyState icon={DoorOpen} title="No units yet" description="Units added to this property appear here." />
          ) : (
            <DataTable caption={`Units in ${property.name}`} columns={UNIT_COLUMNS} rows={units.data.items} getRowId={(unit) => unit.id} />
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby={eventsId}>
        <CardHeader>
          <CardTitle id={eventsId} className="text-base">
            Open monitoring events
          </CardTitle>
          <CardDescription>
            {events.data && events.data.total > EVENTS_SHOWN
              ? `The ${EVENTS_SHOWN} highest-priority of ${events.data.total} events that still need attention.`
              : 'Discrepancies and upcoming obligations at this property that still need attention.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.isPending ? (
            <LoadingState label="Loading the monitoring events…" />
          ) : events.isError ? (
            <ErrorState title="Could not load the monitoring events" error={describeApiError(events.error, 'Try again in a moment.')} onRetry={() => void events.refetch()} />
          ) : events.data.total === 0 ? (
            <EmptyState icon={BellRing} title="Nothing needs attention" description="No open monitoring events at this property." />
          ) : (
            <DataTable caption={`Open monitoring events at ${property.name}`} columns={EVENT_COLUMNS} rows={events.data.items} getRowId={(event) => event.id} />
          )}
        </CardContent>
      </Card>

      {isWriter && !isArchived ? <PropertyFormDialog open={editing} onOpenChange={setEditing} property={property} /> : null}
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
