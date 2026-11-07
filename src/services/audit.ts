import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import type { AuditLog, EntityId, EntityType } from '@/types'

import { applyQuery, type ListQuery, type PagedResult } from '@/services/query'
import { getActiveCompanyId, recordAudit } from '@/services/repository'

export { recordAudit }
export type { AuditEntryInput } from '@/services/repository'

const DEFAULT_SORT: NonNullable<ListQuery<AuditLog>['sort']> = { field: 'occurredAt', direction: 'desc' }
const DEFAULT_SEARCH_FIELDS: readonly (keyof AuditLog)[] = ['summary', 'entityId', 'action', 'entityType']

function scopedLogs(logs: Readonly<Record<EntityId, AuditLog>>, companyId: EntityId): AuditLog[] {
  return Object.values(logs).filter((l) => l.companyId === companyId)
}

export function listAudit(query?: ListQuery<AuditLog>): PagedResult<AuditLog> {
  const { collections } = useAppStore.getState()
  return applyQuery(scopedLogs(collections.auditLogs, getActiveCompanyId()), {
    ...query,
    sort: query?.sort ?? DEFAULT_SORT,
    searchFields: query?.searchFields ?? DEFAULT_SEARCH_FIELDS,
  })
}

export function listAuditForEntity(entityType: EntityType, entityId: EntityId): AuditLog[] {
  return listAudit({ filters: { entityType, entityId }, pageSize: Number.MAX_SAFE_INTEGER }).items
}

// Hooks --------------------------------------------------------------------

export function useAuditLog(query?: ListQuery<AuditLog>): PagedResult<AuditLog> {
  const logs = useAppStore((s) => s.collections.auditLogs)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  const serialised = query ? JSON.stringify(query) : ''
  return useMemo(
    () =>
      applyQuery(scopedLogs(logs, companyId), {
        ...query,
        sort: query?.sort ?? DEFAULT_SORT,
        searchFields: query?.searchFields ?? DEFAULT_SEARCH_FIELDS,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `serialised` captures `query` by value
    [logs, companyId, serialised],
  )
}

export function useAuditForEntity(entityType: EntityType, entityId: EntityId | undefined): AuditLog[] {
  const logs = useAppStore((s) => s.collections.auditLogs)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  return useMemo(
    () =>
      entityId
        ? scopedLogs(logs, companyId)
            .filter((l) => l.entityType === entityType && l.entityId === entityId)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        : [],
    [logs, companyId, entityType, entityId],
  )
}
