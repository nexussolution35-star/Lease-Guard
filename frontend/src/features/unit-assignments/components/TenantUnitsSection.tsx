import type { Tenant, UnitTenantAssignmentListItem } from '@leaseguard/domain'
import { Link2, Unlink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { AppLink, ConfirmationDialog, DataTable, DateDisplay, EmptyState, ErrorState, LoadingState, SectionHeader, type DataTableColumn } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useEndUnitAssignment, useUnitAssignmentList } from '../api/queries'
import { AssignUnitDialog } from './AssignUnitDialog'

export interface TenantUnitsSectionProps {
  tenant: Tenant
  /** Company admins and property managers assign and unassign. */
  canWrite: boolean
}

const RETRY = 'Try again in a moment.'

function columns(canWrite: boolean, onUnassign: (assignment: UnitTenantAssignmentListItem) => void): DataTableColumn<UnitTenantAssignmentListItem>[] {
  const base: DataTableColumn<UnitTenantAssignmentListItem>[] = [
    {
      id: 'unit',
      header: 'Unit',
      rowHeader: true,
      cell: (assignment) => (
        <AppLink to={`/units/${encodeURIComponent(assignment.unitId)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {assignment.unitNumber}
        </AppLink>
      ),
    },
    {
      id: 'property',
      header: 'Property',
      cell: (assignment) => (
        <AppLink to={`/properties/${encodeURIComponent(assignment.propertyId)}`} className="text-foreground hover:underline">
          {assignment.propertyName}
        </AppLink>
      ),
    },
    { id: 'since', header: 'Since', hideBelow: 'sm', cell: (assignment) => <DateDisplay value={assignment.assignedAt} className="tabular-nums" /> },
  ]
  if (!canWrite) return base
  return [
    ...base,
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (assignment) => (
        <Button type="button" variant="ghost" size="sm" aria-label={`Unassign unit ${assignment.unitNumber}`} onClick={() => onUnassign(assignment)}>
          <Unlink aria-hidden="true" />
          Unassign
        </Button>
      ),
    },
  ]
}

/**
 * The units the tenant is assigned to without a lease (property, unit, since). Writers assign the tenant to another
 * unit (property, then unit) and unassign one; an unassigned unit returns to vacant unless a lease keeps it occupied.
 * Ended assignments are kept as history and in the audit log.
 */
export function TenantUnitsSection({ tenant, canWrite }: TenantUnitsSectionProps) {
  const assignments = useUnitAssignmentList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, tenantId: tenant.id, current: true })
  const end = useEndUnitAssignment()
  const [assigning, setAssigning] = useState(false)
  const [unassigning, setUnassigning] = useState<UnitTenantAssignmentListItem | null>(null)

  async function confirmUnassign() {
    if (!unassigning) return
    const ended = await end.mutateAsync(unassigning.id)
    toast.success(`${ended.tenantName} unassigned from unit ${ended.unitNumber}`, { description: ended.propertyName })
  }

  return (
    <section aria-label="Units" className="space-y-3">
      <SectionHeader
        title="Units"
        description="Units the tenant is assigned to without a lease."
        actions={
          canWrite ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setAssigning(true)}>
              <Link2 aria-hidden="true" />
              Assign to unit
            </Button>
          ) : undefined
        }
      />
      {assignments.isPending ? (
        <LoadingState label="Loading the units…" rows={2} />
      ) : assignments.isError ? (
        <ErrorState title="Could not load the units" error={describeApiError(assignments.error, RETRY)} onRetry={() => void assignments.refetch()} />
      ) : assignments.data.total === 0 ? (
        <EmptyState
          title="Not assigned to a unit"
          description="Assign the tenant to a unit to show it as the unit's tenant before a lease is recorded."
          className="py-0"
        />
      ) : (
        <DataTable
          caption={`Units assigned to ${tenant.tradingName}`}
          columns={columns(canWrite, setUnassigning)}
          rows={assignments.data.items}
          getRowId={(assignment) => assignment.id}
        />
      )}

      {canWrite ? <AssignUnitDialog open={assigning} onOpenChange={setAssigning} tenant={tenant} /> : null}
      <ConfirmationDialog
        open={unassigning !== null}
        onOpenChange={(open) => {
          if (!open) setUnassigning(null)
        }}
        title={unassigning ? `Unassign unit ${unassigning.unitNumber}?` : 'Unassign unit?'}
        description={
          unassigning
            ? `${tenant.tradingName} is no longer the tenant of unit ${unassigning.unitNumber} in ${unassigning.propertyName}. The unit returns to vacant unless a lease keeps it occupied. The assignment is kept in its history.`
            : undefined
        }
        confirmLabel="Unassign"
        destructive
        onConfirm={confirmUnassign}
        isPending={end.isPending}
      />
    </section>
  )
}
