import type { AuditAction, AuditLogDto, EntityType } from '@leaseguard/api-client'
import type { EntityId, ISODate } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'

/** One audit log entry; `actorUserId` is absent for actions taken by background jobs. */
export type AuditLogEntry = AuditLogDto

/** Filters of `GET /api/v1/audit-logs`. Entries come newest first. `from` and `to` are inclusive South African days. */
export interface AuditLogListParams {
  /** 1-based. */
  page: number
  pageSize: number
  action?: AuditAction
  entityType?: EntityType
  actorUserId?: EntityId
  from?: ISODate
  to?: ISODate
}

/**
 * The audit log of one company (company-scoped; the company is explicit so a request always matches
 * its query key). Property owners are not audit readers: the API answers them with 403.
 */
export interface AuditSource {
  list(companyId: EntityId, params: AuditLogListParams): Promise<Page<AuditLogEntry>>
}
