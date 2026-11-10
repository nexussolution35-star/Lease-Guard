import { describe, expect, it, vi } from 'vitest'

import { createApiClient, unwrap } from './client.js'
import { ApiError } from './errors.js'
import { compactQuery, pageCount } from './pagination.js'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('createApiClient', () => {
  it('sends the bearer token and active company, and returns typed data', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }))
    const api = createApiClient({ baseUrl: 'http://api.test/', getAccessToken: () => 'tok', getCompanyId: () => 'cmp-1', fetch })

    const page = await unwrap(api.GET('/api/v1/properties', { params: { query: { page: 1 } } }))

    expect(page.total).toBe(0)
    const request = fetch.mock.calls[0]![0] as Request
    expect(request.url).toBe('http://api.test/api/v1/properties?page=1')
    expect(request.headers.get('Authorization')).toBe('Bearer tok')
    expect(request.headers.get('x-company-id')).toBe('cmp-1')
  })

  it('omits credentials when signed out and reports 401s', async () => {
    const onUnauthorized = vi.fn()
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse(401, { statusCode: 401, error: 'Unauthorized', message: 'A bearer access token is required', requestId: 'req-1' }),
    )
    const api = createApiClient({ baseUrl: 'http://api.test', getAccessToken: async () => null, fetch, onUnauthorized })

    const error = await unwrap(api.GET('/api/v1/properties', {})).catch((e: unknown) => e)

    expect((fetch.mock.calls[0]![0] as Request).headers.has('Authorization')).toBe(false)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, messages: ['A bearer access token is required'], requestId: 'req-1' })
    expect((error as ApiError).isUnauthorized).toBe(true)
  })

  it('keeps every validation message', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(400, { statusCode: 400, error: 'Bad Request', message: ['page: too small', 'sort: invalid'], requestId: null }, { 'x-request-id': 'hdr' }),
    )
    const api = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 't', fetch })
    const error = (await unwrap(api.GET('/api/v1/properties', {})).catch((e: unknown) => e)) as ApiError
    expect(error.messages).toEqual(['page: too small', 'sort: invalid'])
    expect(error.requestId).toBe('hdr')
    expect(error.isRetryable).toBe(false)
  })

  it('turns network failures into retryable status-0 errors', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const api = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 't', fetch })
    const error = (await unwrap(api.GET('/api/v1/properties', {})).catch((e: unknown) => e)) as ApiError
    expect(error.isNetworkError).toBe(true)
    expect(error.isRetryable).toBe(true)
  })

  it('handles non-JSON error bodies', async () => {
    const fetch = vi.fn(async () => new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }))
    const api = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 't', fetch })
    const error = (await unwrap(api.GET('/api/v1/properties', {})).catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(502)
    expect(error.isRetryable).toBe(true)
  })
})

describe('pagination helpers', () => {
  it('computes page counts and drops empty query values', () => {
    expect(pageCount({ total: 0, pageSize: 25 })).toBe(1)
    expect(pageCount({ total: 51, pageSize: 25 })).toBe(3)
    expect(compactQuery({ a: 1, b: undefined, c: '', d: null, e: 'x' })).toEqual({ a: 1, e: 'x' })
  })
})
