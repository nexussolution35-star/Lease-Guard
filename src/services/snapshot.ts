import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import type { Collections } from '@/store/collections'
import type {
  AuditLog,
  Communication,
  Company,
  EntityId,
  Lease,
  LeaseDocument,
  MessageApproval,
  MessageTemplate,
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

/**
 * Read-only, company-scoped view of every collection. Report, context and channel services
 * compute from this so plain functions and hooks share one implementation.
 */
export interface ScopedData {
  companyId: EntityId
  company: Company | undefined
  /** Users with a membership in the company. */
  users: User[]
  properties: Property[]
  units: Unit[]
  tenants: Tenant[]
  leases: Lease[]
  leaseDocuments: LeaseDocument[]
  statements: Statement[]
  extractions: StatementExtraction[]
  events: MonitoringEvent[]
  rules: MonitoringRule[]
  arrangements: PaymentArrangement[]
  communications: Communication[]
  templates: MessageTemplate[]
  approvals: MessageApproval[]
  auditLogs: AuditLog[]
}

function scoped<T extends { companyId: EntityId }>(map: Readonly<Record<EntityId, T>>, companyId: EntityId): T[] {
  return Object.values(map).filter((r) => r.companyId === companyId)
}

export function buildScopedData(collections: Collections, companyId: EntityId): ScopedData {
  return {
    companyId,
    company: collections.companies[companyId],
    users: Object.values(collections.users).filter((u) => u.memberships.some((m) => m.companyId === companyId)),
    properties: scoped(collections.properties, companyId),
    units: scoped(collections.units, companyId),
    tenants: scoped(collections.tenants, companyId),
    leases: scoped(collections.leases, companyId),
    leaseDocuments: scoped(collections.leaseDocuments, companyId),
    statements: scoped(collections.statements, companyId),
    extractions: scoped(collections.statementExtractions, companyId),
    events: scoped(collections.monitoringEvents, companyId),
    rules: scoped(collections.monitoringRules, companyId),
    arrangements: scoped(collections.paymentArrangements, companyId),
    communications: scoped(collections.communications, companyId),
    templates: scoped(collections.messageTemplates, companyId),
    approvals: scoped(collections.messageApprovals, companyId),
    auditLogs: scoped(collections.auditLogs, companyId),
  }
}

/** Snapshot of the active workspace. */
export function getScopedData(): ScopedData {
  const { collections, workspace } = useAppStore.getState()
  return buildScopedData(collections, workspace.activeCompanyId)
}

/** Reactive snapshot of the active workspace; recomputed when any collection or the workspace changes. */
export function useScopedData(): ScopedData {
  const collections = useAppStore((s) => s.collections)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  return useMemo(() => buildScopedData(collections, companyId), [collections, companyId])
}

/** Index records by id for joins. */
export function indexById<T extends { id: EntityId }>(items: readonly T[]): ReadonlyMap<EntityId, T> {
  return new Map(items.map((i) => [i.id, i]))
}
