import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import {
  fakeApiClient,
  fakeFetch,
  forbiddenFetch,
  notFoundFetch,
  requestAt,
  sampleRecord,
  TEST_COMPANY_ID,
  TEST_RECORD_ID,
  urlOf,
  type FakeFetch,
} from '@/test/fakeApi'

import { createApiNotificationSource } from './apiSource'

const notification = sampleRecord('notifications')

function sourceWith(fetch: FakeFetch) {
  return createApiNotificationSource(fakeApiClient(fetch))
}

describe('createApiNotificationSource', () => {
  it('lists with the explicit company and every set parameter', async () => {
    const fetch = fakeFetch(200, { items: [notification], total: 1, page: 1, pageSize: 20 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, {
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      direction: 'desc',
      unreadOnly: true,
      type: 'approval_request',
      severity: 'warning',
    })

    expect(page).toEqual({ items: [notification], total: 1, page: 1, pageSize: 20 })
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/notifications',
      query: { page: '1', pageSize: '20', sort: 'createdAt', direction: 'desc', unreadOnly: 'true', type: 'approval_request', severity: 'warning' },
    })
    expect(requestAt(fetch).method).toBe('GET')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('marks one notification read with POST and maps 404 to null', async () => {
    const fetch = fakeFetch(200, { ...notification, read: true, readAt: '2026-11-09T10:00:00+02:00' })
    const updated = await sourceWith(fetch).markRead(TEST_COMPANY_ID, TEST_RECORD_ID)
    expect(updated?.read).toBe(true)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/notifications/${TEST_RECORD_ID}/read`)
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    expect(await sourceWith(notFoundFetch()).markRead(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('does not call the API to mark a non-UUID id read', async () => {
    const fetch = fakeFetch(200, notification)
    expect(await sourceWith(fetch).markRead(TEST_COMPANY_ID, 'ntf_demo')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('marks all read and resolves to the number changed', async () => {
    const fetch = fakeFetch(200, { updated: 3 })
    expect(await sourceWith(fetch).markAllRead(TEST_COMPANY_ID)).toBe(3)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe('/api/v1/notifications/read-all')
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('rethrows API errors', async () => {
    const error = await sourceWith(forbiddenFetch()).markAllRead(TEST_COMPANY_ID).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
  })
})
