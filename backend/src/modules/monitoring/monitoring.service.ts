import { ConflictException, Injectable } from '@nestjs/common'
import { canTransition, OPEN_EVENT_STATUSES, TERMINAL_EVENT_STATUSES, type EntityId, type MonitoringEvent } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { TablesUpdate } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toMonitoringEvent } from './monitoring.mapper'
import {
  MONITORING_EVENT_SORT_COLUMNS,
  type MonitoringEventListQuery,
  type UpdateMonitoringEventStatusBody,
} from './monitoring.schemas'

const SEARCH_COLUMNS = ['title', 'description', 'lease_reference'] as const

/**
 * Monitoring events of one company. Queries run through the caller's RLS-bound client and filter by
 * company explicitly. Who changed a status, and when, is stamped and audited by database triggers
 * (private.stamp_event_status / audit_event_status), so the actor cannot be forged by the client.
 */
@Injectable()
export class MonitoringService {
  async list(db: DbClient, companyId: EntityId, query: MonitoringEventListQuery): Promise<Page<MonitoringEvent>> {
    const filtered = () => {
      let request = db.from('monitoring_events').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.open !== undefined) request = request.in('status', [...(query.open ? OPEN_EVENT_STATUSES : TERMINAL_EVENT_STATUSES)])
      if (query.priority) request = request.eq('priority', query.priority)
      if (query.type) request = request.eq('type', query.type)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.leaseId) request = request.eq('lease_id', query.leaseId)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = MONITORING_EVENT_SORT_COLUMNS[query.sort ?? 'identifiedOn']
    // Only due_date can be null; events without one go last. The other sort columns are NOT NULL, and
    // adding NULLS LAST to them would stop an index on the column from ordering the rows when sorted desc.
    const nulls = sortColumn === 'due_date' ? { nullsFirst: false } : {}
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc', ...nulls })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List monitoring events')
      throw httpErrorFromDatabase(error, 'List monitoring events')
    }
    return toPage(data, count, query, toMonitoringEvent)
  }

  async get(db: DbClient, companyId: EntityId, eventId: EntityId): Promise<MonitoringEvent> {
    const row = unwrapDatabase(
      await db.from('monitoring_events').select('*').eq('company_id', companyId).eq('id', eventId).maybeSingle(),
      'Get monitoring event',
    )
    return toMonitoringEvent(row)
  }

  /**
   * Moves an event to another status. Dismissing records the note as the reason; any other status
   * records it as resolution notes. Triggers stamp resolved/dismissed by and at from the caller.
   */
  async updateStatus(
    db: DbClient,
    companyId: EntityId,
    eventId: EntityId,
    body: UpdateMonitoringEventStatusBody,
  ): Promise<MonitoringEvent> {
    // The workflow rule (domain canTransition) decides which moves are allowed.
    const current = await this.get(db, companyId, eventId)
    if (!canTransition(current.status, body.status)) {
      throw new ConflictException(`An event cannot move from "${current.status}" to "${body.status}"`)
    }

    const patch: TablesUpdate<'monitoring_events'> = { status: body.status }
    if (body.status === 'dismissed') patch.dismissal_reason = body.note ?? null
    else if (body.note !== undefined) patch.resolution_notes = body.note

    // Only update from the status that was checked, so two concurrent changes cannot both apply.
    const { data, error } = await db
      .from('monitoring_events')
      .update(patch)
      .eq('company_id', companyId)
      .eq('id', eventId)
      .eq('status', current.status)
      .select('*')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Update monitoring event status')
    if (!data) throw new ConflictException('The event was changed by someone else; reload it and try again')
    return toMonitoringEvent(data)
  }
}
