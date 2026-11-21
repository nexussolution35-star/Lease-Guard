import { isoToday, type LeaseListItem, type Unit } from '@leaseguard/domain'
import { Info, Pencil } from 'lucide-react'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  DataTable,
  DateDisplay,
  EmptyState,
  ErrorState,
  InformationGrid,
  InformationItem,
  LoadingState,
  SectionHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useLeaseList, useLeaseQuery } from '@/features/leases/api/queries'
import { LeaseTermBars } from '@/features/leases/components/LeaseTermBars'
import { LeaseVerification } from '@/features/leases/components/LeaseVerification'
import { usePropertyQuery } from '@/features/properties/api/queries'
import { useTenantQuery } from '@/features/tenants/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { UnitFormDialog } from './UnitFormDialog'

export interface UnitDetailScreenProps {
  unit: Unit
}

const LEASES_SHOWN = 25
const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })
const area = (squareMetres: number) => `${AREA_FORMAT.format(squareMetres)} m²`
/** In the `lg` rail each detail reads as one row, label left and value right, as in a ledger. */
const RAIL_ITEM = 'lg:grid lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-3 lg:space-y-0 lg:[&>dt]:font-normal'
const NONE = <span className="text-muted-foreground">—</span>

/** Members by id, for the names on lease sign-offs. A name is returned only when the member is loaded. */
function useSignerNames() {
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  return (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined
}

function historyColumns(signerOf: (userId: string | undefined) => string | undefined): DataTableColumn<LeaseListItem>[] {
  return [
    {
      id: 'reference',
      header: 'Lease',
      cell: (lease) => (
        <AppLink to={`/leases/${encodeURIComponent(lease.id)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {lease.reference}
        </AppLink>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (lease) => (
        <AppLink to={`/tenants/${encodeURIComponent(lease.tenantId)}`} className="text-foreground hover:underline">
          {lease.tenantName}
        </AppLink>
      ),
    },
    {
      id: 'term',
      header: 'Term',
      hideBelow: 'md',
      cell: (lease) => (
        <span className="tabular-nums">
          <DateDisplay value={lease.commencementDate} /> – <DateDisplay value={lease.expiryDate} />
        </span>
      ),
    },
    { id: 'status', header: 'Status', cell: (lease) => <StatusBadge status={lease.status} /> },
    { id: 'verified', header: 'Terms verified', hideBelow: 'sm', cell: (lease) => <LeaseVerification lease={lease} signer={signerOf(lease.verifiedByUserId)} /> },
  ]
}

/**
 * One unit: its current tenant and lease (the lease term drawn to scale, with who verified it), every lease the unit
 * has had, and its details with the property in a side rail. The tenant and lease come from the active lease and are
 * never typed in. Writers edit the unit; a unit of an archived property is read-only until the property is restored.
 * Every rule is enforced by the API; the screen explains it.
 */
export function UnitDetailScreen({ unit }: UnitDetailScreenProps) {
  const isWriter = useIsCompanyWriter()
  const [editing, setEditing] = useState(false)
  const today = isoToday(new Date())

  const property = usePropertyQuery(unit.propertyId)
  const currentLease = useLeaseQuery(unit.currentLeaseId ?? '', { enabled: unit.currentLeaseId !== undefined })
  const currentTenant = useTenantQuery(unit.currentTenantId ?? '', { enabled: unit.currentTenantId !== undefined })
  const history = useLeaseList({ page: 1, pageSize: LEASES_SHOWN, unitId: unit.id, sort: 'commencementDate', direction: 'desc' })
  const signerOf = useSignerNames()

  const propertyRecord = property.data ?? undefined
  const isArchived = propertyRecord?.status === 'archived'
  // Editing waits for the property: a unit of an archived property cannot be changed.
  const canEdit = isWriter && propertyRecord !== undefined && !isArchived
  const lease = currentLease.data ?? undefined
  const tenant = currentTenant.data ?? undefined

  const propertyLink = propertyRecord ? (
    <AppLink to={`/properties/${encodeURIComponent(propertyRecord.id)}`} className="text-foreground hover:underline">
      {propertyRecord.name}
    </AppLink>
  ) : property.isPending ? (
    '…'
  ) : (
    'Not available'
  )

  const tenantLink = tenant ? (
    <AppLink to={`/tenants/${encodeURIComponent(tenant.id)}`} className="font-medium text-foreground hover:underline">
      {tenant.tradingName}
    </AppLink>
  ) : unit.currentTenantId && currentTenant.isPending ? (
    '…'
  ) : unit.currentTenantId ? (
    'Not available'
  ) : (
    NONE
  )

  return (
    <section>
      <PageHeader
        title={`Unit ${unit.unitNumber}`}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{unit.unitNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{propertyLink}</span>
            <span aria-hidden="true">·</span>
            <span>{labelFor(unit.type)}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={unit.occupancyStatus} />
          </p>
        }
        actions={
          canEdit ? (
            <Button type="button" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          ) : null
        }
      />

      {isArchived ? (
        <p className="mb-6 flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This unit's property is archived. The unit cannot be changed until the property is restored.
        </p>
      ) : null}

      {/* DOM order is the phone order: the current lease, then the history, then details. From `lg` details sit in a right rail. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
          <section aria-label="Current lease" className="space-y-3">
            <SectionHeader title="Current lease" description="The tenant and lease in force, from the unit's active lease." />
            {unit.currentLeaseId === undefined ? (
              <EmptyState
                title="No current lease"
                description={`The unit is ${labelFor(unit.occupancyStatus).toLowerCase()}. When a lease here is active, its tenant and term show here.`}
                className="py-0"
              />
            ) : currentLease.isPending ? (
              <LoadingState label="Loading the current lease…" rows={2} />
            ) : currentLease.isError ? (
              <ErrorState
                title="Could not load the current lease"
                error={describeApiError(currentLease.error, 'Try again in a moment.')}
                onRetry={() => void currentLease.refetch()}
              />
            ) : lease === undefined ? (
              <EmptyState title="Lease not available" description="The unit's current lease could not be found in this workspace." className="py-0" />
            ) : (
              <div className="rounded-lg border border-border px-4 pt-4 pb-3">
                <dl aria-label="Tenant and lease" className="mb-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Tenant</dt>
                    <dd>{tenantLink}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Lease</dt>
                    <dd className="flex flex-wrap items-center gap-x-2">
                      <AppLink to={`/leases/${encodeURIComponent(lease.id)}`} className="font-medium text-foreground tabular-nums hover:underline">
                        {lease.reference}
                      </AppLink>
                      <StatusBadge status={lease.status} />
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Terms verified by</dt>
                    <dd>
                      <LeaseVerification lease={lease} signer={signerOf(lease.verifiedByUserId)} />
                    </dd>
                  </div>
                </dl>
                <LeaseTermBars leases={[lease]} today={today} className="border-t border-border pt-4" />
              </div>
            )}
          </section>

          <section aria-label="Lease history" className="space-y-3">
            <SectionHeader
              title="Lease history"
              description={
                history.data && history.data.total > LEASES_SHOWN
                  ? `The latest ${LEASES_SHOWN} of ${history.data.total} leases, newest first.`
                  : 'Every lease of this unit, newest first.'
              }
            />
            {history.isPending ? (
              <LoadingState label="Loading the lease history…" />
            ) : history.isError ? (
              <ErrorState title="Could not load the lease history" error={describeApiError(history.error, 'Try again in a moment.')} onRetry={() => void history.refetch()} />
            ) : history.data.total === 0 ? (
              <EmptyState title="No leases yet" description="Leases of this unit appear here." className="py-0" />
            ) : (
              <DataTable caption={`Leases of unit ${unit.unitNumber}`} columns={historyColumns(signerOf)} rows={history.data.items} getRowId={(row) => row.id} />
            )}
          </section>
        </div>

        <section aria-label="Details" className="space-y-4 lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
            <InformationItem label="Property" value={propertyLink} className={RAIL_ITEM} />
            <InformationItem label="Unit type" value={labelFor(unit.type)} className={RAIL_ITEM} />
            <InformationItem label="Floor area" value={<span className="tabular-nums">{area(unit.floorAreaSqm)}</span>} className={RAIL_ITEM} />
            <InformationItem label="Floor" value={unit.floor} className={RAIL_ITEM} />
            <InformationItem label="Occupancy" value={<StatusBadge status={unit.occupancyStatus} />} className={RAIL_ITEM} />
            <InformationItem label="Current tenant" value={tenantLink} className={RAIL_ITEM} />
            <InformationItem label="Added" value={<DateDisplay value={unit.createdAt} className="tabular-nums" />} className={RAIL_ITEM} />
            <InformationItem label="Description" value={unit.description} className={cn(RAIL_ITEM, 'sm:col-span-2 lg:col-span-1')} />
          </InformationGrid>
        </section>
      </div>

      {canEdit ? <UnitFormDialog open={editing} onOpenChange={setEditing} unit={unit} property={propertyRecord} /> : null}
    </section>
  )
}
