import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import type { CollectionEntity, CollectionKey, Collections } from '@/store/collections'
import { generateId, nowISO } from '@/store/ids'
import type { WorkspaceState } from '@/store/schema'
import type { AuditAction, AuditLog, AuditScalar, CompanyScoped, EntityId, EntityType, FieldChange } from '@/types'

import { applyQuery, type ListQuery, type PagedResult } from '@/services/query'

/** Collections whose records carry `companyId`. Companies and users are global. */
export type ScopedCollectionKey = Exclude<CollectionKey, 'companies' | 'users'>
export type ScopedEntity<K extends ScopedCollectionKey> = CollectionEntity<K> & CompanyScoped

export type CreateInput<T extends CompanyScoped> = Omit<T, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
export type UpdateInput<T extends CompanyScoped> = Partial<CreateInput<T>>

export interface MutationOptions {
  /** Override the audit summary. */
  summary?: string
  /** Override the audit action (defaults: create / update / archive / delete). */
  action?: AuditAction
}

export interface RepositoryOptions<K extends ScopedCollectionKey> {
  entityType: EntityType
  /** Human label used in audit summaries, e.g. "Property". */
  label: string
  /** Prefix for generated ids, e.g. `prop`. Defaults to the entity type. */
  idPrefix?: string
  searchFields?: readonly (keyof ScopedEntity<K>)[]
  /** When set, `archive()` patches this field instead of deleting the record. */
  archive?: { field: keyof ScopedEntity<K>; value: ScopedEntity<K>[keyof ScopedEntity<K>] }
}

export interface Repository<K extends ScopedCollectionKey> {
  readonly key: K
  readonly entityType: EntityType
  readonly label: string
  list(query?: ListQuery<ScopedEntity<K>>): PagedResult<ScopedEntity<K>>
  /** All records of the active company, unpaged. */
  listAll(): ScopedEntity<K>[]
  /** Returns `undefined` when the id is unknown or belongs to another company. */
  getById(id: EntityId | undefined): ScopedEntity<K> | undefined
  /** Like `getById` but throws a descriptive error. */
  require(id: EntityId): ScopedEntity<K>
  create(input: CreateInput<ScopedEntity<K>>, options?: MutationOptions): ScopedEntity<K>
  update(id: EntityId, patch: UpdateInput<ScopedEntity<K>>, options?: MutationOptions): ScopedEntity<K>
  /** Soft-archive when configured, otherwise a hard remove. Returns the archived record or undefined when removed. */
  archive(id: EntityId, options?: MutationOptions): ScopedEntity<K> | undefined
  remove(id: EntityId, options?: MutationOptions): void
  count(): number
  useList(query?: ListQuery<ScopedEntity<K>>): PagedResult<ScopedEntity<K>>
  useAll(): ScopedEntity<K>[]
  useById(id: EntityId | undefined): ScopedEntity<K> | undefined
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

export function getWorkspace(): WorkspaceState {
  return useAppStore.getState().workspace
}

export function getActiveCompanyId(): EntityId {
  return getWorkspace().activeCompanyId
}

export function getCurrentUserId(): EntityId {
  return getWorkspace().currentUserId
}

export function useWorkspace(): WorkspaceState {
  return useAppStore((s) => s.workspace)
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntryInput {
  action: AuditAction
  entityType: EntityType
  entityId: EntityId
  summary: string
  changes?: readonly FieldChange[]
  /** Defaults to the active company. */
  companyId?: EntityId
  /** Defaults to the current user. */
  actorUserId?: EntityId
}

/** Append an audit row for the active workspace. Every mutating service call goes through this. */
export function recordAudit(entry: AuditEntryInput): AuditLog {
  const workspace = getWorkspace()
  const at = nowISO()
  const row: AuditLog = {
    id: generateId('aud'),
    companyId: entry.companyId ?? workspace.activeCompanyId,
    createdAt: at,
    updatedAt: at,
    actorUserId: entry.actorUserId ?? workspace.currentUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    occurredAt: at,
    ...(entry.changes && entry.changes.length > 0 ? { changes: entry.changes } : {}),
  }
  useAppStore.getState().upsert('auditLogs', row)
  return row
}

function toAuditScalar(value: unknown): AuditScalar | undefined {
  if (value === undefined || value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value as AuditScalar
  return undefined
}

/** Shallow diff of scalar fields; nested objects/arrays are skipped. */
export function diffScalarFields(before: object, after: object): FieldChange[] {
  const changes: FieldChange[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  for (const field of keys) {
    if (field === 'updatedAt') continue
    const bv = toAuditScalar(b[field])
    const av = toAuditScalar(a[field])
    if (bv === undefined || av === undefined) continue
    if (bv !== av) changes.push({ field, before: bv, after: av })
  }
  return changes
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

type ScopedMap<K extends ScopedCollectionKey> = Readonly<Record<EntityId, ScopedEntity<K>>>

/** Narrow the union-typed collection slot to the concrete scoped record map for `key`. */
function asScopedMap<K extends ScopedCollectionKey>(map: Collections[K]): ScopedMap<K> {
  return map as unknown as ScopedMap<K>
}

function scopedValues<K extends ScopedCollectionKey>(key: K, companyId: EntityId): ScopedEntity<K>[] {
  const map = asScopedMap<K>(useAppStore.getState().collections[key])
  return Object.values(map).filter((r) => r.companyId === companyId)
}

function queryKey<T>(query: ListQuery<T> | undefined): string {
  return query ? JSON.stringify(query) : ''
}

export function createRepository<K extends ScopedCollectionKey>(
  key: K,
  options: RepositoryOptions<K>,
): Repository<K> {
  type T = ScopedEntity<K>
  const { entityType, label } = options
  const idPrefix = options.idPrefix ?? entityType
  const defaultSearchFields = options.searchFields

  const readMap = (): ScopedMap<K> => asScopedMap<K>(useAppStore.getState().collections[key])

  const getById = (id: EntityId | undefined): T | undefined => {
    if (!id) return undefined
    const record = readMap()[id]
    if (!record || record.companyId !== getActiveCompanyId()) return undefined
    return record
  }

  const require = (id: EntityId): T => {
    const record = getById(id)
    if (!record) throw new Error(`${label} ${id} not found in the active workspace`)
    return record
  }

  const withDefaults = (query?: ListQuery<T>): ListQuery<T> => ({
    ...query,
    searchFields: query?.searchFields ?? defaultSearchFields,
  })

  const listAll = (): T[] => scopedValues(key, getActiveCompanyId())

  const list = (query?: ListQuery<T>): PagedResult<T> => applyQuery(listAll(), withDefaults(query))

  const create = (input: CreateInput<T>, mutation?: MutationOptions): T => {
    const workspace = getWorkspace()
    const at = nowISO()
    const record = {
      ...input,
      id: generateId(idPrefix),
      companyId: workspace.activeCompanyId,
      createdAt: at,
      updatedAt: at,
    } as T
    useAppStore.getState().upsert(key, record as CollectionEntity<K>)
    recordAudit({
      action: mutation?.action ?? 'create',
      entityType,
      entityId: record.id,
      summary: mutation?.summary ?? `${label} created`,
    })
    return record
  }

  const update = (id: EntityId, patch: UpdateInput<T>, mutation?: MutationOptions): T => {
    const before = require(id)
    const after = { ...before, ...patch, updatedAt: nowISO() } as T
    useAppStore.getState().upsert(key, after as CollectionEntity<K>)
    recordAudit({
      action: mutation?.action ?? 'update',
      entityType,
      entityId: id,
      summary: mutation?.summary ?? `${label} updated`,
      changes: diffScalarFields(before, after),
    })
    return after
  }

  const remove = (id: EntityId, mutation?: MutationOptions): void => {
    require(id)
    useAppStore.getState().remove(key, id)
    recordAudit({
      action: mutation?.action ?? 'delete',
      entityType,
      entityId: id,
      summary: mutation?.summary ?? `${label} deleted`,
    })
  }

  const archive = (id: EntityId, mutation?: MutationOptions): T | undefined => {
    if (!options.archive) {
      remove(id, mutation)
      return undefined
    }
    const { field, value } = options.archive
    const patch = { [field]: value } as UpdateInput<T>
    return update(id, patch, { action: mutation?.action ?? 'archive', summary: mutation?.summary ?? `${label} archived` })
  }

  const count = (): number => listAll().length

  // Hooks: select the raw map (stable reference) and derive in useMemo so re-renders only
  // happen when the collection or workspace actually changes.
  const useAll = (): T[] => {
    const map = asScopedMap<K>(useAppStore((s) => s.collections[key]))
    const companyId = useAppStore((s) => s.workspace.activeCompanyId)
    return useMemo(() => Object.values(map).filter((r) => r.companyId === companyId), [map, companyId])
  }

  const useList = (query?: ListQuery<T>): PagedResult<T> => {
    const all = useAll()
    const serialised = queryKey(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `serialised` captures `query` by value
    return useMemo(() => applyQuery(all, withDefaults(query)), [all, serialised])
  }

  const useById = (id: EntityId | undefined): T | undefined => {
    const map = asScopedMap<K>(useAppStore((s) => s.collections[key]))
    const companyId = useAppStore((s) => s.workspace.activeCompanyId)
    return useMemo(() => {
      if (!id) return undefined
      const record = map[id]
      return record && record.companyId === companyId ? record : undefined
    }, [map, companyId, id])
  }

  return { key, entityType, label, list, listAll, getById, require, create, update, archive, remove, count, useList, useAll, useById }
}
