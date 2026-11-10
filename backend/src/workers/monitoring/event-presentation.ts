import type { EntityId } from '@leaseguard/domain'

/**
 * How the worker presents domain findings as monitoring events: the names used in titles. Urgency
 * levels and their event priorities (EXPIRY_EVENT_PRIORITY, RENEWAL_EVENT_PRIORITY,
 * arrearsEventPriority) come from @leaseguard/domain.
 */

/** Names of the records a finding is about, resolved once per job. */
export interface RecordNames {
  tenant(tenantId: EntityId | undefined): string
  unit(unitId: EntityId | undefined): string
  /** The property manager responsible for a property. */
  managerOf(propertyId: EntityId): EntityId | undefined
}

export function recordNames(
  tenants: readonly { id: EntityId; trading_name: string }[],
  units: readonly { id: EntityId; unit_number: string }[],
  properties: readonly { id: EntityId; manager_user_id: EntityId }[],
): RecordNames {
  const tenantNames = new Map(tenants.map((t) => [t.id, t.trading_name]))
  const unitNumbers = new Map(units.map((u) => [u.id, u.unit_number]))
  const managers = new Map(properties.map((p) => [p.id, p.manager_user_id]))
  return {
    tenant: (id) => (id ? tenantNames.get(id) : undefined) ?? 'Unknown tenant',
    unit: (id) => (id ? unitNumbers.get(id) : undefined) ?? 'unknown unit',
    managerOf: (propertyId) => managers.get(propertyId),
  }
}

/** "1 day" / "12 days". */
export function dayCount(days: number): string {
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`
}
