import { describe, expect, it, vi } from 'vitest'

import { fakeApiClient, jsonResponse } from '@/test/fakeApi'

import { AddressLookupError, createApiAddressSource } from './addressSuggestions'

type Route = (request: Request) => Response | Promise<Response>

function sourceWith(route: Route) {
  const requests: { url: string; body: Record<string, string> }[] = []
  const api = fakeApiClient(
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const request = input as Request
      const text = await request.clone().text()
      requests.push({ url: request.url, body: text ? (JSON.parse(text) as Record<string, string>) : {} })
      return route(request)
    }),
  )
  return { source: createApiAddressSource(api), requests }
}

describe('createApiAddressSource', () => {
  it('asks the API (never Google) and uses one session token for the searches and the resolve', async () => {
    const { source, requests } = sourceWith((request) =>
      new URL(request.url).pathname.endsWith('/resolve')
        ? jsonResponse(200, { line1: '83 Rivonia Road', city: 'Sandton', province: 'Gauteng', postalCode: '2196' })
        : jsonResponse(200, { suggestions: [{ placeId: 'abc', primary: 'Sandton City', secondary: 'Rivonia Road, Sandhurst' }] }),
    )
    await source.suggest('Sand')
    const [suggestion] = await source.suggest('Sandton City')
    expect(suggestion).toEqual({ id: 'abc', primary: 'Sandton City', secondary: 'Rivonia Road, Sandhurst' })
    expect(await source.resolve(suggestion!)).toMatchObject({ line1: '83 Rivonia Road', province: 'Gauteng' })

    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/api/v1/address-suggestions', '/api/v1/address-suggestions', '/api/v1/address-suggestions/resolve'])
    expect(requests.every((r) => !/google/i.test(r.url))).toBe(true)
    const tokens = requests.map((r) => r.body.sessionToken)
    expect(new Set(tokens).size).toBe(1)
    expect(requests[2]!.body).toEqual({ placeId: 'abc', sessionToken: tokens[0] })

    // The next lookup is a new session.
    await source.suggest('Rosebank')
    expect(requests[3]!.body.sessionToken).not.toBe(tokens[0])
  })

  it('passes the rate limit message on, and reports availability from the API', async () => {
    const { source } = sourceWith((request) =>
      new URL(request.url).pathname.endsWith('/status')
        ? jsonResponse(200, { available: true })
        : jsonResponse(429, { statusCode: 429, error: 'Too Many Requests', message: 'Too many address lookups. Wait a moment, or type the address in full.', requestId: null }),
    )
    expect(await source.available()).toBe(true)
    const error = await source.suggest('Sandton').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AddressLookupError)
    expect((error as Error).message).toBe('Too many address lookups. Wait a moment, or type the address in full.')
  })

  it('is unavailable when the API cannot say', async () => {
    const { source } = sourceWith(() => jsonResponse(503, { statusCode: 503, error: 'Service Unavailable', message: 'x', requestId: null }))
    expect(await source.available()).toBe(false)
  })
})
