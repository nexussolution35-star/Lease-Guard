import { useMemo } from 'react'

import { labelFor } from '@/lib/labels'
import { entityHref } from '@/lib/navigation'
import { useAppStore } from '@/store/appStore'
import type { EntityId, EntityType, Property, Tenant, Unit } from '@/types'

import { listAllArrangements } from '@/services/arrangements'
import { communicationsRepo } from '@/services/communications'
import { listAllLeases } from '@/services/leases'
import { listAllEvents } from '@/services/monitoring'
import { listAllProperties } from '@/services/properties'
import { listAllStatements } from '@/services/statements'
import { listAllTenants } from '@/services/tenants'
import { listAllUnits } from '@/services/units'

export interface SearchResult {
  id: EntityId
  entityType: EntityType
  title: string
  subtitle?: string
  href: string
  /** Raw status value; render with `labelFor` / `StatusBadge`. */
  status?: string
}

export interface SearchResultGroup {
  entityType: EntityType
  label: string
  results: SearchResult[]
}

export const DEFAULT_SEARCH_LIMIT = 5
export const MIN_SEARCH_LENGTH = 2

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

function matches(term: string, ...fields: (string | undefined)[]): boolean {
  return fields.some((f) => f !== undefined && f.toLowerCase().includes(term))
}

function excerpt(text: string, term: string, radius = 40): string {
  const index = text.toLowerCase().indexOf(term)
  if (index < 0 || text.length <= radius * 2) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + term.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function href(entityType: EntityType, id: EntityId): string {
  return entityHref(entityType, id) ?? '/'
}

/**
 * Search the ACTIVE workspace's records. Results are grouped by entity type, each group capped at
 * `limit`; empty groups are omitted. Terms shorter than {@link MIN_SEARCH_LENGTH} return nothing.
 */
export function searchWorkspace(term: string, limit: number = DEFAULT_SEARCH_LIMIT): SearchResultGroup[] {
  const q = normalise(term)
  if (q.length < MIN_SEARCH_LENGTH) return []

  const properties = listAllProperties()
  const units = listAllUnits()
  const tenants = listAllTenants()
  const propertyById = new Map<EntityId, Property>(properties.map((p) => [p.id, p]))
  const unitById = new Map<EntityId, Unit>(units.map((u) => [u.id, u]))
  const tenantById = new Map<EntityId, Tenant>(tenants.map((t) => [t.id, t]))
  const tenantName = (id: EntityId | undefined) => (id ? tenantById.get(id)?.tradingName : undefined)
  const propertyName = (id: EntityId | undefined) => (id ? propertyById.get(id)?.name : undefined)

  const groups: SearchResultGroup[] = []
  const push = (entityType: EntityType, label: string, results: SearchResult[]) => {
    if (results.length > 0) groups.push({ entityType, label, results: results.slice(0, limit) })
  }

  push(
    'property',
    'Properties',
    properties
      .filter((p) => matches(q, p.name, p.code, p.address.suburb, p.address.city))
      .map((p) => ({
        id: p.id,
        entityType: 'property',
        title: p.name,
        subtitle: `${p.code} · ${p.address.suburb}, ${p.address.city}`,
        href: href('property', p.id),
        status: p.status,
      })),
  )

  push(
    'unit',
    'Units',
    units
      .filter((u) => matches(q, u.unitNumber, tenantName(u.currentTenantId)))
      .map((u) => ({
        id: u.id,
        entityType: 'unit',
        title: `Unit ${u.unitNumber}`,
        subtitle: [propertyName(u.propertyId), tenantName(u.currentTenantId)].filter(Boolean).join(' · '),
        href: href('unit', u.id),
        status: u.occupancyStatus,
      })),
  )

  push(
    'tenant',
    'Tenants',
    tenants
      .filter((t) => matches(q, t.tradingName, t.legalName, t.primaryContact.fullName, t.registrationNumber))
      .map((t) => ({
        id: t.id,
        entityType: 'tenant',
        title: t.tradingName,
        subtitle: t.legalName,
        href: href('tenant', t.id),
        status: t.status,
      })),
  )

  push(
    'lease',
    'Leases',
    listAllLeases()
      .filter((l) => matches(q, l.reference))
      .map((l) => ({
        id: l.id,
        entityType: 'lease',
        title: l.reference,
        subtitle: [tenantName(l.tenantId), unitById.get(l.unitId)?.unitNumber].filter(Boolean).join(' · '),
        href: href('lease', l.id),
        status: l.status,
      })),
  )

  push(
    'statement',
    'Statements',
    listAllStatements()
      .filter((s) => matches(q, s.statementNumber, s.file.fileName, tenantName(s.tenantId)))
      .map((s) => ({
        id: s.id,
        entityType: 'statement',
        title: s.statementNumber ?? s.file.fileName,
        subtitle: [tenantName(s.tenantId), propertyName(s.propertyId)].filter(Boolean).join(' · '),
        href: href('statement', s.id),
        status: s.status,
      })),
  )

  push(
    'monitoring_event',
    'Monitoring events',
    listAllEvents()
      .filter((e) => matches(q, e.title, e.leaseReference))
      .map((e) => ({
        id: e.id,
        entityType: 'monitoring_event',
        title: e.title,
        subtitle: [labelFor(e.type), tenantName(e.tenantId)].filter(Boolean).join(' · '),
        href: href('monitoring_event', e.id),
        status: e.status,
      })),
  )

  push(
    'payment_arrangement',
    'Arrangements',
    listAllArrangements()
      .filter((a) => matches(q, tenantName(a.tenantId)))
      .map((a) => ({
        id: a.id,
        entityType: 'payment_arrangement',
        title: tenantName(a.tenantId) ?? 'Payment arrangement',
        subtitle: `Payment arrangement · ${propertyName(a.propertyId) ?? ''}`.replace(/ · $/, ''),
        href: href('payment_arrangement', a.id),
        status: a.status,
      })),
  )

  push(
    'communication',
    'Communications',
    communicationsRepo
      .listAll()
      .filter((c) => matches(q, c.body, tenantName(c.tenantId)))
      .map((c) => ({
        id: c.id,
        entityType: 'communication',
        title: `${labelFor(c.messageType)}${tenantName(c.tenantId) ? ` · ${tenantName(c.tenantId)}` : ''}`,
        subtitle: excerpt(c.body, q),
        href: href('communication', c.id),
        status: c.status,
      })),
  )

  return groups
}

/** Reactive search over the active workspace; recomputes when the term, workspace or data change. */
export function useWorkspaceSearch(term: string, limit: number = DEFAULT_SEARCH_LIMIT): SearchResultGroup[] {
  const collections = useAppStore((s) => s.collections)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  return useMemo(() => {
    // `collections` and `companyId` are read via the list functions; listed here so changes recompute.
    void collections
    void companyId
    return searchWorkspace(term, limit)
  }, [term, limit, collections, companyId])
}
