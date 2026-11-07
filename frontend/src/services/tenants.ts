import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import type { Lease, MonitoringEvent, PaymentArrangement, Property, Statement, Tenant, Unit, ZAR } from '@leaseguard/domain'
import type { EntityId } from '@leaseguard/domain'

import { OPEN_EVENT_STATUSES } from '@/services/monitoring'
import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository } from '@/services/repository'

export const tenantsRepo = createRepository('tenants', {
  entityType: 'tenant',
  label: 'Tenant',
  idPrefix: 'ten',
  searchFields: ['legalName', 'tradingName', 'whatsappNumber', 'industry', 'registrationNumber'],
  archive: { field: 'status', value: 'vacated' },
})

export const listTenants = tenantsRepo.list
export const listAllTenants = tenantsRepo.listAll
export const getTenant = tenantsRepo.getById
export const createTenant = tenantsRepo.create
export const updateTenant = tenantsRepo.update

export function markWhatsAppVerified(tenantId: EntityId, verified = true): Tenant {
  return tenantsRepo.update(
    tenantId,
    { whatsappVerified: verified },
    { action: verified ? 'verify' : 'update', summary: verified ? 'WhatsApp number verified' : 'WhatsApp verification cleared' },
  )
}

export function setOptOut(tenantId: EntityId, optedOut: boolean): Tenant {
  return tenantsRepo.update(
    tenantId,
    { whatsappOptedOut: optedOut },
    { summary: optedOut ? 'Tenant opted out of WhatsApp messages' : 'Tenant opted back in to WhatsApp messages' },
  )
}

export interface TenantSummary {
  tenant: Tenant
  activeLease?: Lease
  unit?: Unit
  property?: Property
  latestStatement?: Statement
  /** Closing balance of the latest verified statement, if any. */
  outstandingBalance?: ZAR
  openEventCount: number
  activeArrangement?: PaymentArrangement
  /** Tenant may receive automated WhatsApp messages. */
  canMessage: boolean
}

export function buildTenantSummary(
  tenant: Tenant,
  leases: readonly Lease[],
  units: readonly Unit[],
  properties: readonly Property[],
  statements: readonly Statement[],
  events: readonly MonitoringEvent[],
  arrangements: readonly PaymentArrangement[],
): TenantSummary {
  const activeLease = leases.find(
    (l) => l.tenantId === tenant.id && (l.status === 'active' || l.status === 'expiring'),
  )
  const unit = activeLease ? units.find((u) => u.id === activeLease.unitId) : undefined
  const property = activeLease ? properties.find((p) => p.id === activeLease.propertyId) : undefined
  const latestStatement = statements
    .filter((s) => s.tenantId === tenant.id && s.status === 'verified')
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]
  const openEventCount = events.filter((e) => e.tenantId === tenant.id && OPEN_EVENT_STATUSES.includes(e.status)).length
  const activeArrangement = arrangements.find((a) => a.tenantId === tenant.id && a.status === 'active')
  return {
    tenant,
    activeLease,
    unit,
    property,
    latestStatement,
    outstandingBalance: latestStatement?.closingBalance,
    openEventCount,
    activeArrangement,
    canMessage: tenant.whatsappVerified && !tenant.whatsappOptedOut,
  }
}

export function getTenantSummary(tenantId: EntityId): TenantSummary | undefined {
  const tenant = tenantsRepo.getById(tenantId)
  if (!tenant) return undefined
  const c = useAppStore.getState().collections
  return buildTenantSummary(
    tenant,
    Object.values(c.leases),
    Object.values(c.units),
    Object.values(c.properties),
    Object.values(c.statements),
    Object.values(c.monitoringEvents),
    Object.values(c.paymentArrangements),
  )
}

// Hooks --------------------------------------------------------------------

export function useTenants(query?: ListQuery<Tenant>): PagedResult<Tenant> {
  return tenantsRepo.useList(query)
}

export const useAllTenants = tenantsRepo.useAll
export const useTenant = tenantsRepo.useById

export function useTenantSummary(tenantId: EntityId | undefined): TenantSummary | undefined {
  const tenant = tenantsRepo.useById(tenantId)
  const leases = useAppStore((s) => s.collections.leases)
  const units = useAppStore((s) => s.collections.units)
  const properties = useAppStore((s) => s.collections.properties)
  const statements = useAppStore((s) => s.collections.statements)
  const events = useAppStore((s) => s.collections.monitoringEvents)
  const arrangements = useAppStore((s) => s.collections.paymentArrangements)
  return useMemo(
    () =>
      tenant
        ? buildTenantSummary(
            tenant,
            Object.values(leases),
            Object.values(units),
            Object.values(properties),
            Object.values(statements),
            Object.values(events),
            Object.values(arrangements),
          )
        : undefined,
    [tenant, leases, units, properties, statements, events, arrangements],
  )
}
