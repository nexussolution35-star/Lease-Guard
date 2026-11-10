import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { toNotification, type NotificationRow } from './notifications.mapper'
import { notificationListQuerySchema } from './notifications.schemas'
import { NotificationsService } from './notifications.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const USER = '6f1d2c1e-0000-4000-8000-0000000000a1'
const NOTIFICATION = '6f1d2c1e-0000-4000-8000-0000000000b1'
const NOW = new Date('2026-11-09T08:00:00+02:00')

class TestNotificationsService extends NotificationsService {
  protected override now(): Date {
    return NOW
  }
}

const row: NotificationRow = {
  id: NOTIFICATION,
  company_id: COMPANY,
  user_id: USER,
  type: 'approval_request',
  severity: 'warning',
  title: 'Message awaiting approval',
  body: 'A follow-up payment reminder needs your approval.',
  read: false,
  read_at: null,
  link_entity_type: 'communication',
  link_entity_id: '6f1d2c1e-0000-4000-8000-0000000000d1',
  dedupe_key: null,
  created_at: '2026-11-08T08:00:00+00:00',
  updated_at: '2026-11-08T08:00:00+00:00',
}

const isUpdate = (query: RecordedQuery): boolean => callsTo(query, 'update').length > 0

describe('notifications mapper', () => {
  it('maps the link and leaves unread fields absent', () => {
    const notification = toNotification(row)
    expect(notification.link).toEqual({ entityType: 'communication', entityId: row.link_entity_id })
    expect(notification).not.toHaveProperty('readAt')
    expect(toNotification({ ...row, link_entity_type: null, link_entity_id: null })).not.toHaveProperty('link')
  })
})

describe('NotificationsService', () => {
  const service = new TestNotificationsService()

  it("lists only the caller's notifications in the company, unread only on request", async () => {
    const { client, queries } = fakeDb(() => ({ data: [row], error: null, count: 1 }))
    const query = notificationListQuerySchema.parse({ unreadOnly: 'true', severity: 'warning' })

    const page = await service.list(client, COMPANY, USER, query)

    expect(page.items).toHaveLength(1)
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['user_id', USER],
      ['read', false],
      ['severity', 'warning'],
    ])
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['created_at', { ascending: false }])
  })

  it('parses unreadOnly strictly from the query string', () => {
    expect(notificationListQuerySchema.parse({ unreadOnly: 'false' }).unreadOnly).toBe(false)
    expect(notificationListQuerySchema.parse({}).unreadOnly).toBeUndefined()
    expect(notificationListQuerySchema.safeParse({ unreadOnly: 'maybe' }).success).toBe(false)
  })

  it('marks one notification read, touching only read and read_at', async () => {
    const { client, queries } = fakeDb((query) => {
      const patch = callsTo(query, 'update')[0]?.[0] as Partial<NotificationRow>
      return { data: { ...row, ...patch }, error: null }
    })

    const notification = await service.markRead(client, COMPANY, USER, NOTIFICATION)

    expect(notification).toMatchObject({ read: true, readAt: NOW.toISOString() })
    expect(queries).toHaveLength(1)
    expect(callsTo(queries[0]!, 'update')).toEqual([[{ read: true, read_at: NOW.toISOString() }]])
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['user_id', USER],
      ['id', NOTIFICATION],
      ['read', false],
    ])
  })

  it('keeps the original readAt when the notification is already read', async () => {
    const alreadyRead = { ...row, read: true, read_at: '2026-11-08T09:00:00+00:00' }
    const { client, queries } = fakeDb((query) => ({ data: isUpdate(query) ? null : alreadyRead, error: null }))

    const notification = await service.markRead(client, COMPANY, USER, NOTIFICATION)

    expect(notification.readAt).toBe('2026-11-08T09:00:00+00:00')
    expect(queries.map(isUpdate)).toEqual([true, false])
  })

  it("returns 404 for someone else's or a missing notification", async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.markRead(client, COMPANY, USER, NOTIFICATION)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('marks all unread notifications read and reports how many changed', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null, count: 4 }))

    expect(await service.markAllRead(client, COMPANY, USER)).toEqual({ updated: 4 })
    expect(callsTo(queries[0]!, 'update')).toEqual([[{ read: true, read_at: NOW.toISOString() }, { count: 'exact' }]])
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['user_id', USER],
      ['read', false],
    ])
  })
})
