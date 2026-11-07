import { useMemo } from 'react'

import { todayISO } from '@/store/ids'
import type {
  Communication,
  EntityId,
  ISODate,
  Lease,
  LeaseDocument,
  MonitoringEvent,
  MonitoringRule,
  PaymentArrangement,
  Property,
  Statement,
  StatementExtraction,
  Tenant,
  Unit,
  User,
} from '@/types'

import { buildReminderSuppressionStatus, type ReminderSuppressionStatus } from '@/services/arrangements'
import { sortConversation } from '@/services/communications'
import { OPEN_EVENT_STATUSES } from '@/services/monitoring'
import { computePropertyStats, type PropertyStats } from '@/services/properties'
import { getScopedData, useScopedData, type ScopedData } from '@/services/snapshot'
import { buildTenantSummary, type TenantSummary } from '@/services/tenants'

/**
 * Detail-page context builders: one record plus every related record of the ACTIVE company.
 * Records from other companies are never joined (the snapshot is company-scoped).
 */

const byDateDesc = <T,>(pick: (t: T) => string) => (a: T, b: T) => pick(b).localeCompare(pick(a))
const isCurrent = (l: Lease) => l.status === 'active' || l.status === 'expiring'

export interface PropertyContext {
  property: Property
  stats: PropertyStats
  manager?: User
  owner?: User
  units: Unit[]
  leases: Lease[]
  tenants: Tenant[]
  openEvents: MonitoringEvent[]
  statements: Statement[]
  arrangements: PaymentArrangement[]
}

export function buildPropertyContext(data: ScopedData, propertyId: EntityId): PropertyContext | undefined {
  const property = data.properties.find((p) => p.id === propertyId)
  if (!property) return undefined
  const units = data.units.filter((u) => u.propertyId === propertyId)
  const leases = data.leases.filter((l) => l.propertyId === propertyId).sort(byDateDesc((l) => l.commencementDate))
  const tenantIds = new Set(leases.filter(isCurrent).map((l) => l.tenantId))
  const manager = data.users.find((u) => u.id === property.managerUserId)
  const owner = property.ownerUserId ? data.users.find((u) => u.id === property.ownerUserId) : undefined
  return {
    property,
    stats: computePropertyStats(propertyId, units, leases),
    ...(manager ? { manager } : {}),
    ...(owner ? { owner } : {}),
    units,
    leases,
    tenants: data.tenants.filter((t) => tenantIds.has(t.id)),
    openEvents: data.events.filter((e) => e.propertyId === propertyId && OPEN_EVENT_STATUSES.includes(e.status)),
    statements: data.statements.filter((s) => s.propertyId === propertyId).sort(byDateDesc((s) => s.statementDate)),
    arrangements: data.arrangements.filter((a) => a.propertyId === propertyId),
  }
}

export interface UnitContext {
  unit: Unit
  property?: Property
  currentLease?: Lease
  tenant?: Tenant
  leaseHistory: Lease[]
  events: MonitoringEvent[]
  statements: Statement[]
}

export function buildUnitContext(data: ScopedData, unitId: EntityId): UnitContext | undefined {
  const unit = data.units.find((u) => u.id === unitId)
  if (!unit) return undefined
  const property = data.properties.find((p) => p.id === unit.propertyId)
  const leaseHistory = data.leases.filter((l) => l.unitId === unitId).sort(byDateDesc((l) => l.commencementDate))
  const currentLease = (unit.currentLeaseId ? leaseHistory.find((l) => l.id === unit.currentLeaseId) : undefined) ?? leaseHistory.find(isCurrent)
  const tenantId = unit.currentTenantId ?? currentLease?.tenantId
  const tenant = tenantId ? data.tenants.find((t) => t.id === tenantId) : undefined
  return {
    unit,
    ...(property ? { property } : {}),
    ...(currentLease ? { currentLease } : {}),
    ...(tenant ? { tenant } : {}),
    leaseHistory,
    events: data.events.filter((e) => e.unitId === unitId).sort(byDateDesc((e) => e.identifiedOn)),
    statements: data.statements.filter((s) => s.unitId === unitId).sort(byDateDesc((s) => s.statementDate)),
  }
}

export interface TenantContext {
  tenant: Tenant
  summary: TenantSummary
  leases: Lease[]
  units: Unit[]
  properties: Property[]
  statements: Statement[]
  events: MonitoringEvent[]
  arrangements: PaymentArrangement[]
  /** Communication history with this tenant, oldest first, active company only. */
  communications: Communication[]
  reminderSuppression: ReminderSuppressionStatus
}

export function buildTenantContext(data: ScopedData, tenantId: EntityId, today: ISODate): TenantContext | undefined {
  const tenant = data.tenants.find((t) => t.id === tenantId)
  if (!tenant) return undefined
  const leases = data.leases.filter((l) => l.tenantId === tenantId).sort(byDateDesc((l) => l.commencementDate))
  const unitIds = new Set(leases.map((l) => l.unitId))
  const propertyIds = new Set(leases.map((l) => l.propertyId))
  return {
    tenant,
    summary: buildTenantSummary(tenant, data.leases, data.units, data.properties, data.statements, data.events, data.arrangements),
    leases,
    units: data.units.filter((u) => unitIds.has(u.id)),
    properties: data.properties.filter((p) => propertyIds.has(p.id)),
    statements: data.statements.filter((s) => s.tenantId === tenantId).sort(byDateDesc((s) => s.statementDate)),
    events: data.events.filter((e) => e.tenantId === tenantId).sort(byDateDesc((e) => e.identifiedOn)),
    arrangements: data.arrangements.filter((a) => a.tenantId === tenantId),
    communications: sortConversation(data.communications.filter((c) => c.tenantId === tenantId)),
    reminderSuppression: buildReminderSuppressionStatus(tenantId, data.arrangements, today),
  }
}

export interface LeaseContext {
  lease: Lease
  tenant?: Tenant
  unit?: Unit
  property?: Property
  documents: LeaseDocument[]
  events: MonitoringEvent[]
  statements: Statement[]
  arrangements: PaymentArrangement[]
  previousLease?: Lease
  /** Leases that renewed this one. */
  renewals: Lease[]
}

export function buildLeaseContext(data: ScopedData, leaseId: EntityId): LeaseContext | undefined {
  const lease = data.leases.find((l) => l.id === leaseId)
  if (!lease) return undefined
  const tenant = data.tenants.find((t) => t.id === lease.tenantId)
  const unit = data.units.find((u) => u.id === lease.unitId)
  const property = data.properties.find((p) => p.id === lease.propertyId)
  const previousLease = lease.previousLeaseId ? data.leases.find((l) => l.id === lease.previousLeaseId) : undefined
  return {
    lease,
    ...(tenant ? { tenant } : {}),
    ...(unit ? { unit } : {}),
    ...(property ? { property } : {}),
    documents: data.leaseDocuments.filter((d) => d.leaseId === leaseId).sort(byDateDesc((d) => d.uploadedAt)),
    events: data.events.filter((e) => e.leaseId === leaseId).sort(byDateDesc((e) => e.identifiedOn)),
    statements: data.statements.filter((s) => s.leaseId === leaseId).sort(byDateDesc((s) => s.statementDate)),
    arrangements: data.arrangements.filter((a) => a.leaseId === leaseId),
    ...(previousLease ? { previousLease } : {}),
    renewals: data.leases.filter((l) => l.previousLeaseId === leaseId),
  }
}

/** A monitoring event with its source references (lease, statement, rule) and related records. */
export interface EventContext {
  event: MonitoringEvent
  property?: Property
  unit?: Unit
  tenant?: Tenant
  lease?: Lease
  statement?: Statement
  extraction?: StatementExtraction
  arrangement?: PaymentArrangement
  rule?: MonitoringRule
  assignee?: User
}

export function buildEventContext(data: ScopedData, eventId: EntityId): EventContext | undefined {
  const event = data.events.find((e) => e.id === eventId)
  if (!event) return undefined
  const find = <T extends { id: EntityId }>(items: readonly T[], id: EntityId | undefined) => (id ? items.find((i) => i.id === id) : undefined)
  const statement = find(data.statements, event.statementId)
  const rule = find(data.rules, event.ruleId) ?? data.rules.find((r) => r.eventType === event.type)
  const property = find(data.properties, event.propertyId)
  const unit = find(data.units, event.unitId)
  const tenant = find(data.tenants, event.tenantId)
  const lease = find(data.leases, event.leaseId)
  const extraction = find(data.extractions, statement?.extractionId)
  const arrangement = find(data.arrangements, event.arrangementId)
  const assignee = find(data.users, event.assignedToUserId)
  return {
    event,
    ...(property ? { property } : {}),
    ...(unit ? { unit } : {}),
    ...(tenant ? { tenant } : {}),
    ...(lease ? { lease } : {}),
    ...(statement ? { statement } : {}),
    ...(extraction ? { extraction } : {}),
    ...(arrangement ? { arrangement } : {}),
    ...(rule ? { rule } : {}),
    ...(assignee ? { assignee } : {}),
  }
}

// Plain functions -----------------------------------------------------------

export const getPropertyContext = (propertyId: EntityId) => buildPropertyContext(getScopedData(), propertyId)
export const getUnitContext = (unitId: EntityId) => buildUnitContext(getScopedData(), unitId)
export const getTenantContext = (tenantId: EntityId, today: ISODate = todayISO()) => buildTenantContext(getScopedData(), tenantId, today)
export const getLeaseContext = (leaseId: EntityId) => buildLeaseContext(getScopedData(), leaseId)
export const getEventContext = (eventId: EntityId) => buildEventContext(getScopedData(), eventId)

/** Communication history with a tenant, scoped to the tenant AND the active company (empty for other companies' tenants). */
export function getTenantCommunicationHistory(tenantId: EntityId): Communication[] {
  const data = getScopedData()
  if (!data.tenants.some((t) => t.id === tenantId)) return []
  return sortConversation(data.communications.filter((c) => c.tenantId === tenantId))
}

// Hooks --------------------------------------------------------------------

export function usePropertyContext(propertyId: EntityId | undefined): PropertyContext | undefined {
  const data = useScopedData()
  return useMemo(() => (propertyId ? buildPropertyContext(data, propertyId) : undefined), [data, propertyId])
}

export function useUnitContext(unitId: EntityId | undefined): UnitContext | undefined {
  const data = useScopedData()
  return useMemo(() => (unitId ? buildUnitContext(data, unitId) : undefined), [data, unitId])
}

export function useTenantContext(tenantId: EntityId | undefined, today: ISODate = todayISO()): TenantContext | undefined {
  const data = useScopedData()
  return useMemo(() => (tenantId ? buildTenantContext(data, tenantId, today) : undefined), [data, tenantId, today])
}

export function useLeaseContext(leaseId: EntityId | undefined): LeaseContext | undefined {
  const data = useScopedData()
  return useMemo(() => (leaseId ? buildLeaseContext(data, leaseId) : undefined), [data, leaseId])
}

export function useEventContext(eventId: EntityId | undefined): EventContext | undefined {
  const data = useScopedData()
  return useMemo(() => (eventId ? buildEventContext(data, eventId) : undefined), [data, eventId])
}

export function useTenantCommunicationHistory(tenantId: EntityId | undefined): Communication[] {
  const data = useScopedData()
  return useMemo(
    () =>
      tenantId && data.tenants.some((t) => t.id === tenantId)
        ? sortConversation(data.communications.filter((c) => c.tenantId === tenantId))
        : [],
    [data, tenantId],
  )
}
