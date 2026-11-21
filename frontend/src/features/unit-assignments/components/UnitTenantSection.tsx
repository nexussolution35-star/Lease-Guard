import type { PropertyStatus, Unit } from '@leaseguard/domain'
import { Link2, Unlink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { AppLink, ConfirmationDialog, DateDisplay, EmptyState, SectionHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useTenantQuery } from '@/features/tenants/api/queries'

import { useEndUnitAssignment } from '../api/queries'
import { AssignTenantDialog } from './AssignTenantDialog'

export interface UnitTenantSectionProps {
  unit: Unit
  propertyStatus: PropertyStatus | undefined
  /** Company admins and property managers, while the property is not archived. */
  canWrite: boolean
}

/**
 * The unit's tenant: the tenant assigned to it without a lease (since when), with Unassign; or, while it is neither
 * assigned nor let, Assign tenant. A unit let under a current lease shows its tenant in the current lease section.
 */
export function UnitTenantSection({ unit, propertyStatus, canWrite }: UnitTenantSectionProps) {
  const assignment = unit.currentAssignment
  const currentTenant = useTenantQuery(unit.currentTenantId ?? '', { enabled: unit.currentTenantId !== undefined && unit.currentLeaseId !== undefined })
  const end = useEndUnitAssignment()
  const [assigning, setAssigning] = useState(false)
  const [unassigning, setUnassigning] = useState(false)

  async function confirmUnassign() {
    if (!assignment) return
    const ended = await end.mutateAsync(assignment.id)
    toast.success(`${ended.tenantName} unassigned from unit ${ended.unitNumber}`)
  }

  const leaseTenant = currentTenant.data ?? undefined
  const action = !canWrite ? undefined : assignment ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setUnassigning(true)}>
      <Unlink aria-hidden="true" />
      Unassign
    </Button>
  ) : unit.currentLeaseId === undefined ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setAssigning(true)}>
      <Link2 aria-hidden="true" />
      Assign tenant
    </Button>
  ) : undefined

  return (
    <section aria-label="Tenant" className="space-y-3">
      <SectionHeader title="Tenant" description="The tenant of the active lease, else the tenant assigned to the unit." actions={action} />
      {assignment ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border border-border px-4 py-3 text-sm">
          <AppLink to={`/tenants/${encodeURIComponent(assignment.tenantId)}`} className="font-medium text-foreground hover:underline">
            {assignment.tenantName}
          </AppLink>
          <span className="text-muted-foreground">
            Assigned{unit.currentLeaseId === undefined ? ' without a lease' : ''} since <DateDisplay value={assignment.assignedAt} className="tabular-nums" />
          </span>
        </div>
      ) : unit.currentLeaseId !== undefined ? (
        <p className="rounded-lg border border-border px-4 py-3 text-sm">
          {leaseTenant ? (
            <AppLink to={`/tenants/${encodeURIComponent(leaseTenant.id)}`} className="font-medium text-foreground hover:underline">
              {leaseTenant.tradingName}
            </AppLink>
          ) : (
            '…'
          )}
          <span className="text-muted-foreground"> · by the current lease</span>
        </p>
      ) : (
        <EmptyState title="No tenant" description="Assign a tenant to show who occupies the unit before a lease is recorded." className="py-0" />
      )}

      {canWrite && !assignment ? (
        <AssignTenantDialog open={assigning} onOpenChange={setAssigning} unit={unit} propertyStatus={propertyStatus} />
      ) : null}
      <ConfirmationDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={`Unassign ${assignment?.tenantName ?? 'the tenant'}?`}
        description={`${assignment?.tenantName ?? 'The tenant'} is no longer the tenant of unit ${unit.unitNumber}. The unit returns to vacant unless a lease keeps it occupied. The assignment is kept in its history.`}
        confirmLabel="Unassign"
        destructive
        onConfirm={confirmUnassign}
        isPending={end.isPending}
      />
    </section>
  )
}
