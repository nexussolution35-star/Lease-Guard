import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  dueWindowRange,
  OPEN_EVENT_STATUSES,
  TERMINAL_EVENT_STATUSES,
  UNASSIGNED_FILTER,
  type EntityId,
  type MonitoringEventListItem,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import { saToday } from '../../common/sa-today'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toMonitoringEvent, type MonitoringEventRow } from './monitoring.mapper'
import {
  MONITORING_EVENT_SORT_COLUMNS,
  type MonitoringEventListQuery,
  type UpdateMonitoringEventStatusBody,
} from './monitoring.schemas'

const SEARCH_COLUMNS = ['title', 'description', 'lease_reference'] as const

/** What `update_monitoring_event_status` refuses with: a move the workflow does not allow, a bad note, another company's event. */
const STATUS_ERRORS: DatabaseErrorOverrides = {
  P0001: (error) => new ConflictException(error.message),
  '22023': (error) => new UnprocessableEntityException(error.message),
  P0002: (error) => new NotFoundException(error.message),
}

/**
 * A list row also names its property and, when set, its unit, tenant and assignee (to-one embeds over the composite
 * foreign keys; the assignee through company_users to the member's profile).
 */
const MONITORING_EVENT_LIST_SELECT =
  '*, property:properties!monitoring_events_property_fk(name), unit:units!monitoring_events_unit_fk(unit_number), tenant:tenants!monitoring_events_tenant_fk(trading_name), assignee:company_users!monitoring_events_assigned_to_fk(profile:profiles(full_name))'

type MonitoringEventListRow = MonitoringEventRow & {
  property: { name: string } | null
  unit: { unit_number: string } | null
  tenant: { trading_name: string } | null
  assignee: { profile: { full_name: string } | null } | null
}

export function toMonitoringEventListItem({ property, unit, tenant, assignee, ...row }: MonitoringEventListRow): MonitoringEventListItem {
  const assigneeName = assignee?.profile?.full_name
  return {
    ...toMonitoringEvent(row),
    propertyName: property?.name ?? '',
    ...(unit ? { unitNumber: unit.unit_number } : {}),
    ...(tenant ? { tenantName: tenant.trading_name } : {}),
    ...(assigneeName ? { assigneeName } : {}),
  }
}

/**
 * Monitoring events of one company. Queries run through the caller's RLS-bound client and filter by
 * company explicitly. A status change goes through the database function `update_monitoring_event_status`
 * (signed-in users cannot update the table); who changed it, and when, is stamped and audited by database
 * triggers (private.stamp_event_status / audit_event_status), so the actor cannot be forged by the client.
 */
@Injectable()
export class MonitoringService {
  /** `now` is the clock for the due-date window (tests pass one); the window uses the South African date. */
  async list(
    db: DbClient,
    companyId: EntityId,
    query: MonitoringEventListQuery,
    now: Date = new Date(),
  ): Promise<Page<MonitoringEventListItem>> {
    const due = query.due ? dueWindowRange(query.due, saToday(now)) : null
    const filtered = () => {
      let request = db.from('monitoring_events').select(MONITORING_EVENT_LIST_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.open !== undefined) request = request.in('status', [...(query.open ? OPEN_EVENT_STATUSES : TERMINAL_EVENT_STATUSES)])
      if (query.priority) request = request.eq('priority', query.priority)
      if (query.type) request = request.eq('type', query.type)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.unitId) request = request.eq('unit_id', query.unitId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.leaseId) request = request.eq('lease_id', query.leaseId)
      if (query.arrangementId) request = request.eq('arrangement_id', query.arrangementId)
      if (query.assignee === UNASSIGNED_FILTER) request = request.is('assigned_to_user_id', null)
      else if (query.assignee) request = request.eq('assigned_to_user_id', query.assignee)
      if (due?.from) request = request.gte('due_date', due.from)
      if (due) request = request.lte('due_date', due.to)
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
    return toPage(data, count, query, toMonitoringEventListItem)
  }

  /** One event, with the names of its property, unit, tenant and assignee as the list shows them. */
  async get(db: DbClient, companyId: EntityId, eventId: EntityId): Promise<MonitoringEventListItem> {
    const row = unwrapDatabase(
      await db.from('monitoring_events').select(MONITORING_EVENT_LIST_SELECT).eq('company_id', companyId).eq('id', eventId).maybeSingle(),
      'Get monitoring event',
    )
    return toMonitoringEventListItem(row)
  }

  /**
   * Moves an event to another status through `public.update_monitoring_event_status`, the only write path for a
   * signed-in caller. The database locks the event and allows exactly the domain workflow (`EVENT_TRANSITIONS`, 409
   * otherwise); dismissing records the note as the reason (required), any other status as resolution notes. Triggers
   * stamp resolved/dismissed by and at from the caller and audit the change with the note.
   */
  async updateStatus(
    db: DbClient,
    companyId: EntityId,
    eventId: EntityId,
    body: UpdateMonitoringEventStatusBody,
  ): Promise<MonitoringEventListItem> {
    unwrapDatabase(
      await db.rpc('update_monitoring_event_status', {
        p_company_id: companyId,
        p_event_id: eventId,
        p_status: body.status,
        ...(body.note === undefined ? {} : { p_note: body.note }),
      }),
      'Update monitoring event status',
      STATUS_ERRORS,
    )
    return this.get(db, companyId, eventId)
  }
}
