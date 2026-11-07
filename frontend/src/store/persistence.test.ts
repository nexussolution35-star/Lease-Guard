import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PersistedSlice } from '@/store/schema'
import { createFixtureCollections, FIXTURE_IDS, FIXTURE_WORKSPACE } from '@/store/testFixtures'

vi.mock('@/services/demo/seed', () => ({
  DEMO_REFERENCE_DATE: '2026-11-06',
  DEMO_COMPANY_IDS: { nexus: 'cmp_nexus', second: 'cmp_atlas' },
  DEMO_DEFAULT_USER_ID: 'usr_thandi',
  createDemoSeed: () => createFixtureCollections(),
}))

const { STORAGE_KEY, useAppStore, selectActiveCompany, selectCurrentUser, selectCollection, selectWorkspace } =
  await import('@/store/appStore')
const { SCHEMA_VERSION, validatePersistedState } = await import('@/store/schema')
const { generateId, nowISO, todayISO } = await import('@/store/ids')

function validSlice(): PersistedSlice {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspace: { ...FIXTURE_WORKSPACE },
    collections: createFixtureCollections(),
    seededAt: '2026-11-06T08:00:00+02:00',
  }
}

function without<T>(map: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const copy: Record<string, T> = { ...map }
  delete copy[id]
  return copy
}

describe('ids', () => {
  it('generates prefixed unique ids', () => {
    const a = generateId('lease')
    const b = generateId('lease')
    expect(a).toMatch(/^lease_[a-z0-9]{20}$/)
    expect(a).not.toBe(b)
  })

  it('formats timestamps in SAST with a +02:00 offset', () => {
    const stamp = nowISO(new Date('2026-11-06T06:30:15Z'))
    expect(stamp).toBe('2026-11-06T08:30:15+02:00')
    expect(todayISO(new Date('2026-11-06T22:30:00Z'))).toBe('2026-11-07')
  })
})

describe('validatePersistedState', () => {
  it('accepts a valid slice', () => {
    const slice = validSlice()
    const result = validatePersistedState(slice)
    expect(result).not.toBeNull()
    expect(result?.workspace).toEqual(FIXTURE_WORKSPACE)
    expect(Object.keys(result?.collections.companies ?? {})).toHaveLength(2)
  })

  it('rejects garbage', () => {
    expect(validatePersistedState(null)).toBeNull()
    expect(validatePersistedState('nope')).toBeNull()
    expect(validatePersistedState(42)).toBeNull()
    expect(validatePersistedState({})).toBeNull()
    expect(validatePersistedState([])).toBeNull()
  })

  it('rejects a wrong schema version', () => {
    expect(validatePersistedState({ ...validSlice(), schemaVersion: SCHEMA_VERSION + 1 })).toBeNull()
  })

  it('rejects missing collection keys', () => {
    const slice = validSlice()
    const { leases: _leases, ...rest } = slice.collections
    expect(validatePersistedState({ ...slice, collections: rest })).toBeNull()
  })

  it('rejects records whose key does not match their id', () => {
    const slice = validSlice()
    const tenant = Object.values(slice.collections.tenants)[0]
    const tenants = { ...slice.collections.tenants, wrong_key: tenant }
    expect(validatePersistedState({ ...slice, collections: { ...slice.collections, tenants } })).toBeNull()
  })

  it('rejects records without a string id', () => {
    const slice = validSlice()
    const units = { ...slice.collections.units, bad: { foo: 'bar' } }
    expect(validatePersistedState({ ...slice, collections: { ...slice.collections, units } })).toBeNull()
  })

  it('rejects dangling workspace ids', () => {
    const slice = validSlice()
    expect(validatePersistedState({ ...slice, workspace: { ...slice.workspace, activeCompanyId: 'cmp_ghost' } })).toBeNull()
    expect(validatePersistedState({ ...slice, workspace: { ...slice.workspace, currentUserId: 'usr_ghost' } })).toBeNull()
  })
})

describe('useAppStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().resetDemoData()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('seeds from createDemoSeed on first load', () => {
    const state = useAppStore.getState()
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(selectWorkspace(state)).toEqual(FIXTURE_WORKSPACE)
    expect(selectActiveCompany(state)?.name).toBe('Nexus Solution')
    expect(selectCurrentUser(state)?.fullName).toBe('Thandi Mokoena')
    expect(Object.keys(selectCollection('units')(state))).toHaveLength(3)
    expect(state.seededAt).toMatch(/\+02:00$/)
  })

  it('persists the slice to localStorage under leaseguard.state', () => {
    useAppStore.getState().setCurrentUser(FIXTURE_IDS.users.sipho)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw ?? '{}') as { state: Record<string, unknown>; version: number }
    expect(parsed.version).toBe(SCHEMA_VERSION)
    expect(Object.keys(parsed.state).sort()).toEqual(['collections', 'schemaVersion', 'seededAt', 'workspace'])
    expect(parsed.state.workspace).toEqual({ activeCompanyId: 'cmp_nexus', currentUserId: 'usr_sipho' })
  })

  it('reseeds when persisted JSON has an invalid shape', async () => {
    // Make the live state visibly different from a fresh seed.
    useAppStore.getState().remove('units', FIXTURE_IDS.units.sowetoA2)
    expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(2)

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { workspace: 'nonsense' }, version: SCHEMA_VERSION }))
    await useAppStore.persist.rehydrate()

    expect(console.warn).toHaveBeenCalled()
    expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(3)
    expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)
  })

  it('reseeds when the persisted version does not match', async () => {
    useAppStore.getState().remove('units', FIXTURE_IDS.units.sowetoA2)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: validSlice(), version: SCHEMA_VERSION + 5 }))
    await useAppStore.persist.rehydrate()
    expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(3)
  })

  it('reseeds when persisted workspace points at unknown ids', async () => {
    const slice = validSlice()
    slice.workspace.currentUserId = 'usr_ghost'
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: slice, version: SCHEMA_VERSION }))
    await useAppStore.persist.rehydrate()
    expect(useAppStore.getState().workspace.currentUserId).toBe(FIXTURE_IDS.users.thandi)
  })

  it('hydrates a valid persisted slice as-is', async () => {
    const slice = validSlice()
    slice.workspace = { activeCompanyId: FIXTURE_IDS.companies.atlas, currentUserId: FIXTURE_IDS.users.sipho }
    slice.collections = { ...slice.collections, units: without(slice.collections.units, FIXTURE_IDS.units.sowetoA2) }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: slice, version: SCHEMA_VERSION }))
    await useAppStore.persist.rehydrate()
    expect(useAppStore.getState().workspace).toEqual(slice.workspace)
    expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(2)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('survives unparseable localStorage content', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    await expect(useAppStore.persist.rehydrate()).resolves.toBeUndefined()
    expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(3)
  })

  describe('generic mutations', () => {
    it('upsert, patch, bulkUpsert and remove', () => {
      const unit = { ...useAppStore.getState().collections.units[FIXTURE_IDS.units.sowetoA2], id: 'unit_new' }
      useAppStore.getState().upsert('units', unit)
      expect(useAppStore.getState().collections.units.unit_new).toBeDefined()

      useAppStore.getState().patch('units', 'unit_new', { floorAreaSqm: 999 })
      expect(useAppStore.getState().collections.units.unit_new.floorAreaSqm).toBe(999)

      useAppStore.getState().patch('units', 'unit_missing', { floorAreaSqm: 1 })
      expect(useAppStore.getState().collections.units.unit_missing).toBeUndefined()

      useAppStore.getState().bulkUpsert('units', [
        { ...unit, id: 'unit_b1' },
        { ...unit, id: 'unit_b2' },
      ])
      expect(Object.keys(useAppStore.getState().collections.units)).toHaveLength(6)

      useAppStore.getState().remove('units', 'unit_new')
      expect(useAppStore.getState().collections.units.unit_new).toBeUndefined()
    })

    it('does not touch other collections on write', () => {
      const before = useAppStore.getState().collections.leases
      useAppStore.getState().patch('units', FIXTURE_IDS.units.sowetoA2, { floor: '1' })
      expect(useAppStore.getState().collections.leases).toBe(before)
    })
  })

  describe('switchWorkspace', () => {
    it('keeps the current user when they belong to the target company', () => {
      useAppStore.getState().setCurrentUser(FIXTURE_IDS.users.sipho)
      useAppStore.getState().switchWorkspace(FIXTURE_IDS.companies.atlas)
      expect(useAppStore.getState().workspace).toEqual({
        activeCompanyId: FIXTURE_IDS.companies.atlas,
        currentUserId: FIXTURE_IDS.users.sipho,
      })
    })

    it('switches to the first active member when the current user has no membership there', () => {
      // Thandi only belongs to Nexus.
      useAppStore.getState().switchWorkspace(FIXTURE_IDS.companies.atlas)
      expect(useAppStore.getState().workspace).toEqual({
        activeCompanyId: FIXTURE_IDS.companies.atlas,
        currentUserId: FIXTURE_IDS.users.sipho,
      })
    })

    it('ignores unknown companies and companies without any active member', () => {
      useAppStore.getState().switchWorkspace('cmp_ghost')
      expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)

      useAppStore.getState().patch('users', FIXTURE_IDS.users.sipho, { status: 'suspended' })
      useAppStore.getState().switchWorkspace(FIXTURE_IDS.companies.atlas)
      expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)
    })
  })

  describe('setCurrentUser', () => {
    it('moves to the user default workspace when they are not a member of the active one', () => {
      useAppStore.getState().switchWorkspace(FIXTURE_IDS.companies.atlas)
      useAppStore.getState().setCurrentUser(FIXTURE_IDS.users.thandi)
      expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)
    })

    it('ignores unknown users', () => {
      useAppStore.getState().setCurrentUser('usr_ghost')
      expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)
    })
  })

  describe('resetDemoData', () => {
    it('restores the seed and resets the workspace', () => {
      useAppStore.getState().remove('tenants', FIXTURE_IDS.tenants.pickNPay)
      useAppStore.getState().switchWorkspace(FIXTURE_IDS.companies.atlas)
      const seededBefore = useAppStore.getState().seededAt

      useAppStore.getState().resetDemoData()

      const state = useAppStore.getState()
      expect(state.collections.tenants[FIXTURE_IDS.tenants.pickNPay]).toBeDefined()
      expect(state.collections).toEqual(createFixtureCollections())
      expect(state.workspace).toEqual(FIXTURE_WORKSPACE)
      expect(typeof seededBefore).toBe('string')
    })

    it('hydrateFrom replaces collections and workspace for tests', () => {
      const base = createFixtureCollections()
      const collections = { ...base, leases: without(base.leases, FIXTURE_IDS.leases.coastalLaw) }
      useAppStore.getState().hydrateFrom(collections, {
        activeCompanyId: FIXTURE_IDS.companies.atlas,
        currentUserId: FIXTURE_IDS.users.sipho,
      })
      expect(Object.keys(useAppStore.getState().collections.leases)).toHaveLength(1)
      expect(useAppStore.getState().workspace.activeCompanyId).toBe(FIXTURE_IDS.companies.atlas)
    })
  })
})
