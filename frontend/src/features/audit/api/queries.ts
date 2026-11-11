import type { UseQueryResult } from '@tanstack/react-query'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getAuditSource } from './selectSource'
import type { AuditLogEntry, AuditLogListParams } from './source'

export const auditKeys = createEntityKeys('audit-logs')

/** A page of the active workspace's audit log (audit readers only; disable it for other roles). */
export function useAuditLogList(params: AuditLogListParams, options: { enabled?: boolean } = {}): UseQueryResult<Page<AuditLogEntry>> {
  return useCompanyQuery(
    (companyId) => auditKeys.list(companyId, params),
    (companyId) => getAuditSource().list(companyId, params),
    { keepPrevious: true, ...options },
  )
}
