/**
 * Store + services against the REAL demo seed (no mocks). Covers seeding, workspace scoping,
 * reset-demo-data, localStorage round-trips and recovery from corrupted persisted state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDemoSeed, DEMO_COMPANY_IDS, DEMO_DEFAULT_USER_ID } from '@/data'
import * as services from '@/services'
import { selectActiveCompany, selectCurrentUser, STORAGE_KEY, useAppStore } from '@/store/appStore'
import { COLLECTION_KEYS, type Collections } from '@/store/collections'
import { SCHEMA_VERSION, type PersistedSlice } from '@/store/schema'

const NEXUS = DEMO_COMPANY_IDS.nexus
const SECOND = DEMO_COMPANY_IDS.second
const SEED = createDemoSeed()

function counts(collections: Collections): Record<string, number> {
  return Object.fromEntries(COLLECTION_KEYS.map((key) => [key, Object.keys(collections[key]).length]))
}

function scopedCount(key: Exclude<keyof Collections, 'companies' | 'users'>, companyId: string): number {
  return Object.values(SEED[key]).filter((r) => r.companyId === companyId).length
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('seeding', () => {
  it('starts in the Nexus workspace as the default property manager with the full seed', () => {
    const state = useAppStore.getState()
    expect(state.workspace).toEqual({ activeCompanyId: NEXUS, currentUserId: DEMO_DEFAULT_USER_ID })
    expect(selectActiveCompany(state)?.id).toBe(NEXUS)
    expect(selectCurrentUser(state)?.id).toBe(DEMO_DEFAULT_USER_ID)
    expect(services.getCurrentRole()).toBe('property_manager')
    expect(counts(state.collections)).toEqual(counts(SEED))
    expect(state.collections).toEqual(SEED)
  })

  it('does not share references with the seed module', () => {
    const state = useAppStore.getState()
    expect(state.collections).not.toBe(SEED)
    const firstLease = Object.keys(SEED.leases)[0]
    expect(state.collections.leases[firstLease]).not.toBe(SEED.leases[firstLease])
  })
})

describe('workspace scoping through services', () => {
  it('lists only Nexus records in the default workspace', () => {
    const scoped = ['properties', 'units', 'tenants', 'leases', 'statements', 'monitoringEvents', 'paymentArrangements', 'communications'] as const
    const repos = {
      properties: services.propertiesRepo,
      units: services.unitsRepo,
      tenants: services.tenantsRepo,
      leases: services.leasesRepo,
      statements: services.statementsRepo,
      monitoringEvents: services.eventsRepo,
      paymentArrangements: services.arrangementsRepo,
      communications: services.communicationsRepo,
    }
    for (const key of scoped) {
      const records = repos[key].listAll()
      expect(records.length, key).toBe(scopedCount(key, NEXUS))
      expect(records.every((r) => r.companyId === NEXUS), key).toBe(true)
    }
    expect(services.listCompanies()).toHaveLength(Object.keys(SEED.companies).length)
    expect(services.listCompanyUsers().every((u) => u.memberships.some((m) => m.companyId === NEXUS))).toBe(true)
  })

  it('switching to the second company shows only its records and keeps the shared manager logged in', () => {
    const before = services.getCurrentUser()
    useAppStore.getState().switchWorkspace(SECOND)
    const state = useAppStore.getState()
    expect(state.workspace.activeCompanyId).toBe(SECOND)

    const current = services.getCurrentUser()
    if (before.memberships.some((m) => m.companyId === SECOND)) {
      expect(current.id).toBe(before.id)
    } else {
      expect(current.memberships.some((m) => m.companyId === SECOND)).toBe(true)
    }
    expect(services.getCurrentRole()).toBeDefined()

    expect(services.propertiesRepo.listAll().every((p) => p.companyId === SECOND)).toBe(true)
    expect(services.propertiesRepo.count()).toBe(scopedCount('properties', SECOND))
    expect(services.unitsRepo.count()).toBe(scopedCount('units', SECOND))
    expect(services.tenantsRepo.count()).toBe(scopedCount('tenants', SECOND))
    expect(services.leasesRepo.count()).toBe(scopedCount('leases', SECOND))
    expect(services.eventsRepo.count()).toBe(scopedCount('monitoringEvents', SECOND))
    expect(services.statementsRepo.count()).toBe(scopedCount('statements', SECOND))

    // Nexus records are invisible, even by id.
    const nexusProperty = Object.values(SEED.properties).find((p) => p.companyId === NEXUS)
    expect(services.getProperty(nexusProperty?.id)).toBeUndefined()
    expect(services.listForCurrentUser().every((n) => n.companyId === SECOND)).toBe(true)
    expect(services.listAudit().items.every((a) => a.companyId === SECOND)).toBe(true)
  })

  it('mutations are written into the active company with an audit row by the current user', () => {
    useAppStore.getState().switchWorkspace(SECOND)
    const property = services.propertiesRepo.listAll()[0]
    const unit = services.createUnit({
      propertyId: property.id,
      unitNumber: 'Kiosk K1',
      type: 'kiosk',
      floorAreaSqm: 9,
      occupancyStatus: 'vacant',
    })
    expect(unit.companyId).toBe(SECOND)
    const audit = services.listAuditForEntity('unit', unit.id)
    expect(audit).toHaveLength(1)
    expect(audit[0].actorUserId).toBe(useAppStore.getState().workspace.currentUserId)
    expect(audit[0].companyId).toBe(SECOND)

    useAppStore.getState().switchWorkspace(NEXUS)
    expect(services.getUnit(unit.id)).toBeUndefined()
  })
})

describe('resetDemoData', () => {
  it('restores seed counts and the default workspace after mutations', () => {
    const tenant = services.tenantsRepo.listAll()[0]
    services.updateTenant(tenant.id, { notes: 'edited in test' })
    services.createUnit({
      propertyId: services.propertiesRepo.listAll()[0].id,
      unitNumber: 'TMP',
      type: 'storage',
      floorAreaSqm: 5,
      occupancyStatus: 'vacant',
    })
    const lease = services.leasesRepo.listAll().find((l) => l.status === 'active')
    if (lease) services.terminateLease(lease.id, 'test')
    useAppStore.getState().switchWorkspace(SECOND)
    expect(counts(useAppStore.getState().collections)).not.toEqual(counts(SEED))

    useAppStore.getState().resetDemoData()

    const state = useAppStore.getState()
    expect(counts(state.collections)).toEqual(counts(SEED))
    expect(state.collections).toEqual(SEED)
    expect(state.workspace).toEqual({ activeCompanyId: NEXUS, currentUserId: DEMO_DEFAULT_USER_ID })
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('persistence', () => {
  function readPersisted(): { state: PersistedSlice; version: number } {
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    return JSON.parse(raw as string) as { state: PersistedSlice; version: number }
  }

  it('writes the slice to localStorage and rehydrates it unchanged', async () => {
    const tenant = services.tenantsRepo.listAll()[0]
    services.updateTenant(tenant.id, { notes: 'persisted note' })
    useAppStore.getState().switchWorkspace(SECOND)

    const persisted = readPersisted()
    expect(persisted.version).toBe(SCHEMA_VERSION)
    expect(persisted.state.workspace.activeCompanyId).toBe(SECOND)
    expect(persisted.state.collections.tenants[tenant.id].notes).toBe('persisted note')
    expect(Object.keys(persisted.state).sort()).toEqual(['collections', 'schemaVersion', 'seededAt', 'workspace'])

    // Replace the in-memory state so rehydration is observable. hydrateFrom persists too, so put
    // the earlier snapshot back as if the browser had been reopened with it.
    const raw = localStorage.getItem(STORAGE_KEY) as string
    useAppStore.getState().hydrateFrom(createDemoSeed(), { activeCompanyId: NEXUS, currentUserId: DEMO_DEFAULT_USER_ID })
    expect(useAppStore.getState().collections.tenants[tenant.id].notes).not.toBe('persisted note')
    localStorage.setItem(STORAGE_KEY, raw)

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(state.workspace.activeCompanyId).toBe(SECOND)
    expect(state.collections.tenants[tenant.id].notes).toBe('persisted note')
    expect(state.collections).toEqual(persisted.state.collections)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('reseeds when the persisted JSON is corrupted', async () => {
    const tenant = services.tenantsRepo.listAll()[0]
    services.updateTenant(tenant.id, { notes: 'will be lost' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { collections: 'nope', workspace: null }, version: SCHEMA_VERSION }))

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(console.warn).toHaveBeenCalled()
    expect(state.collections).toEqual(SEED)
    expect(state.workspace).toEqual({ activeCompanyId: NEXUS, currentUserId: DEMO_DEFAULT_USER_ID })
  })

  it('reseeds when the persisted schema version does not match', async () => {
    const tenant = services.tenantsRepo.listAll()[0]
    services.updateTenant(tenant.id, { notes: 'old version' })
    const persisted = readPersisted()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: persisted.state, version: SCHEMA_VERSION + 1 }))

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(console.warn).toHaveBeenCalled()
    expect(state.collections.tenants[tenant.id].notes).not.toBe('old version')
    expect(counts(state.collections)).toEqual(counts(SEED))
  })

  it('reseeds when the persisted workspace points at unknown ids', async () => {
    const persisted = readPersisted()
    persisted.state.workspace.currentUserId = 'usr_ghost'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    await useAppStore.persist.rehydrate()

    expect(useAppStore.getState().workspace.currentUserId).toBe(DEMO_DEFAULT_USER_ID)
  })

  it('survives unparseable localStorage content', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    await expect(useAppStore.persist.rehydrate()).resolves.toBeUndefined()
    expect(counts(useAppStore.getState().collections)).toEqual(counts(SEED))
  })
})
