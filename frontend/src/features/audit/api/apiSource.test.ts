import { ApiError, createApiClient } from '@leaseguard/api-client'
import { describe, expect, it, vi } from 'vitest'

import { createApiAuditSource } from './apiSource'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const ACTOR = '5b0c1d2e-0000-4000-8000-0000000000a2'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function firstRequest(fetch: { mock: { calls: unknown[][] } }): Request {
  const request = fetch.mock.calls[0]?.[0]
  if (!(request instanceof Request)) throw new Error('expected a Request')
  return request
}

function sourceWith(fetch: typeof globalThis.fetch) {
  return createApiAuditSource(createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'token', getCompanyId: () => 'other', fetch }))
}

describe('createApiAuditSource', () => {
  it('lists entries newest first with the explicit company and only the set filters', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { items: [], total: 0, page: 2, pageSize: 25 }))
    await sourceWith(fetch).list(COMPANY, { page: 2, pageSize: 25, action: 'verify', actorUserId: ACTOR, from: '2026-10-01' })

    const request = firstRequest(fetch)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/audit-logs')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      pageSize: '25',
      sort: 'occurredAt',
      direction: 'desc',
      action: 'verify',
      actorUserId: ACTOR,
      from: '2026-10-01',
    })
    expect(request.headers.get('x-company-id')).toBe(COMPANY)
  })

  it('rethrows a refusal (property owners are not audit readers)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(403, { statusCode: 403, message: 'Forbidden' }))
    await expect(sourceWith(fetch).list(COMPANY, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ApiError)
  })
})
