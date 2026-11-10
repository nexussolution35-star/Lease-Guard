import { Injectable } from '@nestjs/common'
import { addDaysISO, type EntityId, type ISODate } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toAuditLogEntry, type AuditLogEntry } from './audit.mapper'
import { AUDIT_LOG_SORT_COLUMNS, type AuditLogListQuery } from './audit.schemas'

const SEARCH_COLUMNS = ['summary'] as const

/** South Africa is UTC+02:00 all year (no daylight saving). */
const SA_UTC_OFFSET = '+02:00'

/** Start of a South African calendar day as a timestamp. */
function startOfSADay(date: ISODate): string {
  return `${date}T00:00:00${SA_UTC_OFFSET}`
}

/**
 * Reads the append-only audit log of one company. There are no write operations: entries are written
 * by database triggers and the backend, and the table rejects updates and deletes.
 */
@Injectable()
export class AuditService {
  async list(db: DbClient, companyId: EntityId, query: AuditLogListQuery): Promise<Page<AuditLogEntry>> {
    const filtered = () => {
      let request = db.from('audit_logs').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.entityType) request = request.eq('entity_type', query.entityType)
      if (query.entityId) request = request.eq('entity_id', query.entityId)
      if (query.action) request = request.eq('action', query.action)
      if (query.actorUserId) request = request.eq('actor_user_id', query.actorUserId)
      if (query.from) request = request.gte('occurred_at', startOfSADay(query.from))
      // `to` is inclusive: everything before the start of the following day.
      if (query.to) request = request.lt('occurred_at', startOfSADay(addDaysISO(query.to, 1)))
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = AUDIT_LOG_SORT_COLUMNS[query.sort ?? 'occurredAt']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List audit logs')
      throw httpErrorFromDatabase(error, 'List audit logs')
    }
    return toPage(data, count, query, toAuditLogEntry)
  }
}
