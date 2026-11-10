import { Injectable } from '@nestjs/common'
import type { EntityId, Notification } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toNotification, type MarkAllReadResult } from './notifications.mapper'
import { NOTIFICATION_SORT_COLUMNS, type NotificationListQuery } from './notifications.schemas'

const SEARCH_COLUMNS = ['title', 'body'] as const

/**
 * The caller's own in-app notifications in the active company. Queries filter by company and by the
 * caller explicitly; Row Level Security enforces the same. Users may change only `read` / `read_at`
 * (column grants), so the updates here never touch any other column.
 */
@Injectable()
export class NotificationsService {
  /** The current time; a method so tests can control it. */
  protected now(): Date {
    return new Date()
  }

  async list(db: DbClient, companyId: EntityId, userId: EntityId, query: NotificationListQuery): Promise<Page<Notification>> {
    const filtered = () => {
      let request = db
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('company_id', companyId)
        .eq('user_id', userId)
      if (query.unreadOnly) request = request.eq('read', false)
      if (query.type) request = request.eq('type', query.type)
      if (query.severity) request = request.eq('severity', query.severity)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = NOTIFICATION_SORT_COLUMNS[query.sort ?? 'createdAt']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List notifications')
      throw httpErrorFromDatabase(error, 'List notifications')
    }
    return toPage(data, count, query, toNotification)
  }

  /** Marks one notification read. Idempotent: an already-read notification keeps its original `readAt`. */
  async markRead(db: DbClient, companyId: EntityId, userId: EntityId, notificationId: EntityId): Promise<Notification> {
    const { data, error } = await db
      .from('notifications')
      .update({ read: true, read_at: this.now().toISOString() })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('id', notificationId)
      .eq('read', false)
      .select('*')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Mark notification read')
    if (data) return toNotification(data)

    // Nothing changed: either it was already read, or it is not the caller's notification (404).
    const row = unwrapDatabase(
      await db
        .from('notifications')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .eq('id', notificationId)
        .maybeSingle(),
      'Get notification',
    )
    return toNotification(row)
  }

  /** Marks every unread notification of the caller in this company as read. */
  async markAllRead(db: DbClient, companyId: EntityId, userId: EntityId): Promise<MarkAllReadResult> {
    const { error, count } = await db
      .from('notifications')
      .update({ read: true, read_at: this.now().toISOString() }, { count: 'exact' })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('read', false)
    if (error) throw httpErrorFromDatabase(error, 'Mark all notifications read')
    return { updated: count ?? 0 }
  }
}
