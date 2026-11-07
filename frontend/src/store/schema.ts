import { z } from 'zod'

import { COLLECTION_KEYS, type CollectionEntity, type CollectionKey, type Collections } from '@/store/collections'
import type { EntityId, ISODateTime } from '@leaseguard/domain'

export const SCHEMA_VERSION = 1

export interface WorkspaceState {
  activeCompanyId: EntityId
  currentUserId: EntityId
}

/** The part of the store that is written to localStorage. */
export interface PersistedSlice {
  schemaVersion: number
  workspace: WorkspaceState
  collections: Collections
  seededAt: ISODateTime
}

export interface AppActions {
  upsert<K extends CollectionKey>(key: K, record: CollectionEntity<K>): void
  patch<K extends CollectionKey>(key: K, id: EntityId, partial: Partial<CollectionEntity<K>>): void
  remove(key: CollectionKey, id: EntityId): void
  bulkUpsert<K extends CollectionKey>(key: K, records: readonly CollectionEntity<K>[]): void
  switchWorkspace(companyId: EntityId): void
  setCurrentUser(userId: EntityId): void
  resetDemoData(): void
  /** Test/internal: replace collections and workspace wholesale without touching the seed. */
  hydrateFrom(collections: Collections, workspace: WorkspaceState): void
}

export type AppState = PersistedSlice & AppActions

const recordSchema = z.object({ id: z.string().min(1) }).loose()
const recordMapSchema = z.record(z.string(), recordSchema)

const collectionsShape = Object.fromEntries(COLLECTION_KEYS.map((key) => [key, recordMapSchema])) as Record<
  CollectionKey,
  typeof recordMapSchema
>

const persistedSliceSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  workspace: z.object({
    activeCompanyId: z.string().min(1),
    currentUserId: z.string().min(1),
  }),
  collections: z.object(collectionsShape).loose(),
  seededAt: z.string().min(1),
})

/**
 * Structural validation of whatever came out of localStorage. Returns `null` when the shape is
 * not usable (caller reseeds). Deliberately shallow: entity-level invariants belong to the seed
 * and the services, not to the hydration path.
 */
export function validatePersistedState(input: unknown): PersistedSlice | null {
  const parsed = persistedSliceSchema.safeParse(input)
  if (!parsed.success) return null

  const { collections, workspace } = parsed.data
  for (const key of COLLECTION_KEYS) {
    const map = collections[key]
    for (const [id, record] of Object.entries(map)) {
      if (record.id !== id) return null
    }
  }
  if (!(workspace.activeCompanyId in collections.companies)) return null
  if (!(workspace.currentUserId in collections.users)) return null

  return {
    schemaVersion: parsed.data.schemaVersion,
    workspace: { ...workspace },
    // Shape has been checked key by key; entity fields are trusted from here on.
    collections: collections as unknown as Collections,
    seededAt: parsed.data.seededAt,
  }
}
