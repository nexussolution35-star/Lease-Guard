import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

import { createDemoSeed, DEMO_COMPANY_IDS, DEMO_DEFAULT_USER_ID } from '@/services/demo/seed'
import type { CollectionEntity, CollectionKey, Collections, RecordMap } from '@/store/collections'
import { nowISO } from '@/store/ids'
import {
  SCHEMA_VERSION,
  validatePersistedState,
  type AppState,
  type PersistedSlice,
  type WorkspaceState,
} from '@/store/schema'
import type { Company, EntityId, User } from '@leaseguard/domain'

export const STORAGE_KEY = 'leaseguard.state'

function freshSlice(): PersistedSlice {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspace: { activeCompanyId: DEMO_COMPANY_IDS.nexus, currentUserId: DEMO_DEFAULT_USER_ID },
    collections: createDemoSeed(),
    seededAt: nowISO(),
  }
}

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/** localStorage when available (browser, jsdom); a no-op otherwise (SSR, node tests). */
function resolveStorage(): StateStorage {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage
  } catch {
    // Accessing localStorage can throw in locked-down browsers.
  }
  return noopStorage
}

function readMap<K extends CollectionKey>(collections: Collections, key: K): RecordMap<CollectionEntity<K>> {
  return collections[key] as RecordMap<CollectionEntity<K>>
}

function writeMap<K extends CollectionKey>(
  collections: Collections,
  key: K,
  map: RecordMap<CollectionEntity<K>>,
): Collections {
  const copy: Collections = { ...collections }
  copy[key] = map as Collections[K]
  return copy
}

function upsertInto<K extends CollectionKey>(
  collections: Collections,
  key: K,
  records: readonly CollectionEntity<K>[],
): Collections {
  const map: Record<EntityId, CollectionEntity<K>> = { ...readMap(collections, key) }
  for (const record of records) map[record.id] = record
  return writeMap(collections, key, map)
}

function patchInto<K extends CollectionKey>(
  collections: Collections,
  key: K,
  id: EntityId,
  partial: Partial<CollectionEntity<K>>,
): Collections | undefined {
  const existing = readMap(collections, key)[id]
  if (!existing) return undefined
  const updated: CollectionEntity<K> = { ...existing, ...partial }
  return upsertInto(collections, key, [updated])
}

function removeFrom<K extends CollectionKey>(collections: Collections, key: K, id: EntityId): Collections | undefined {
  const map: Record<EntityId, CollectionEntity<K>> = { ...readMap(collections, key) }
  if (!(id in map)) return undefined
  delete map[id]
  return writeMap(collections, key, map)
}

function pickSlice(state: AppState): PersistedSlice {
  return {
    schemaVersion: state.schemaVersion,
    workspace: state.workspace,
    collections: state.collections,
    seededAt: state.seededAt,
  }
}

function hasMembership(user: User | undefined, companyId: EntityId): boolean {
  return Boolean(user?.memberships.some((m) => m.companyId === companyId))
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...freshSlice(),

      upsert(key, record) {
        set((state) => ({ collections: upsertInto(state.collections, key, [record]) }))
      },

      patch(key, id, partial) {
        set((state) => {
          const next = patchInto(state.collections, key, id, partial)
          return next ? { collections: next } : {}
        })
      },

      remove(key, id) {
        set((state) => {
          const next = removeFrom(state.collections, key, id)
          return next ? { collections: next } : {}
        })
      },

      bulkUpsert(key, records) {
        if (records.length === 0) return
        set((state) => ({ collections: upsertInto(state.collections, key, records) }))
      },

      switchWorkspace(companyId) {
        const { collections, workspace } = get()
        if (!(companyId in collections.companies)) return
        if (companyId === workspace.activeCompanyId) return

        const currentUser = collections.users[workspace.currentUserId]
        let nextUserId = workspace.currentUserId
        if (!hasMembership(currentUser, companyId)) {
          const candidate = Object.values(collections.users).find(
            (u) => u.status === 'active' && hasMembership(u, companyId),
          )
          if (!candidate) return
          nextUserId = candidate.id
        }
        set({ workspace: { activeCompanyId: companyId, currentUserId: nextUserId } })
      },

      setCurrentUser(userId) {
        const { collections, workspace } = get()
        const user = collections.users[userId]
        if (!user) return
        if (!hasMembership(user, workspace.activeCompanyId)) {
          const defaultMembership = user.memberships.find((m) => m.isDefault) ?? user.memberships[0]
          if (!defaultMembership) return
          set({ workspace: { activeCompanyId: defaultMembership.companyId, currentUserId: userId } })
          return
        }
        set({ workspace: { ...workspace, currentUserId: userId } })
      },

      resetDemoData() {
        set(freshSlice())
      },

      hydrateFrom(collections, workspace) {
        set({ collections, workspace, schemaVersion: SCHEMA_VERSION, seededAt: nowISO() })
      },
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => resolveStorage()),
      partialize: pickSlice,
      migrate: (_persisted, version) => {
        if (version !== SCHEMA_VERSION) {
          console.warn(`[leaseguard] persisted schema v${version} != v${SCHEMA_VERSION}; reseeding demo data`)
          return freshSlice()
        }
        return _persisted as PersistedSlice
      },
      merge: (persisted, current) => {
        const valid = validatePersistedState(persisted)
        if (!valid) {
          console.warn('[leaseguard] persisted state failed validation; reseeding demo data')
          return { ...current, ...freshSlice() }
        }
        return { ...current, ...valid }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectWorkspace = (state: AppState): WorkspaceState => state.workspace

export function selectCollection<K extends CollectionKey>(key: K): (state: AppState) => Collections[K] {
  return (state) => state.collections[key]
}

export const selectActiveCompany = (state: AppState): Company | undefined =>
  state.collections.companies[state.workspace.activeCompanyId]

export const selectCurrentUser = (state: AppState): User | undefined =>
  state.collections.users[state.workspace.currentUserId]
