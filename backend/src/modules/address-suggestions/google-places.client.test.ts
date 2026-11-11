import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiEnv } from '../../config/env'
import { GooglePlacesClient, GooglePlacesUnavailableError } from './google-places.client'

const KEY = 'server-only-key-123'
const TOKEN = '6f1d2c1e-0000-4000-8000-000000000001'
const env = (key: string | null = KEY) => ({ GOOGLE_MAPS_API_KEY: key ?? undefined, GOOGLE_PLACES_API_URL: 'https://places.googleapis.com' }) as unknown as ApiEnv

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const call = (fetch: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit & { headers: Record<string, string> }]
  return { url: url.toString(), init, headers: init.headers }
}

afterEach(() => vi.unstubAllGlobals())

describe('GooglePlacesClient', () => {
  it('searches South Africa with the key in a header only, asking for the fields it uses', async () => {
    const fetch = stubFetch(200, {
      suggestions: [
        { placePrediction: { placeId: 'abc', text: { text: 'Sandton City, Rivonia Road' }, structuredFormat: { mainText: { text: 'Sandton City' }, secondaryText: { text: 'Rivonia Road, Sandhurst, Sandton' } } } },
        { placePrediction: { placeId: 'def', text: { text: 'Sandton' } } },
        { queryPrediction: { text: { text: 'sandton restaurants' } } },
      ],
    })
    const suggestions = await new GooglePlacesClient(env()).autocomplete('Sandton City', TOKEN)

    expect(suggestions).toEqual([
      { placeId: 'abc', primary: 'Sandton City', secondary: 'Rivonia Road, Sandhurst, Sandton' },
      { placeId: 'def', primary: 'Sandton' },
    ])
    const { url, init, headers } = call(fetch)
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete')
    expect(url).not.toContain(KEY)
    expect(headers['X-Goog-Api-Key']).toBe(KEY)
    expect(headers['X-Goog-FieldMask']).not.toContain('*')
    expect(JSON.parse(String(init.body))).toEqual({ input: 'Sandton City', sessionToken: TOKEN, includedRegionCodes: ['za'], languageCode: 'en', regionCode: 'za' })
  })

  it('reads the address of a place with the same session token and only the Essentials fields', async () => {
    const fetch = stubFetch(200, {
      formattedAddress: '83 Rivonia Rd, Sandhurst, Sandton, 2196, South Africa',
      addressComponents: [
        { longText: '83', shortText: '83', types: ['street_number'] },
        { longText: 'Rivonia Road', shortText: 'Rivonia Rd', types: ['route'] },
        { longText: 'Gauteng', shortText: 'GP', types: ['administrative_area_level_1'] },
        { longText: '2196', shortText: '2196', types: ['postal_code'] },
      ],
    })
    expect(await new GooglePlacesClient(env()).address('ChIJ-abc_123', TOKEN)).toEqual({ line1: '83 Rivonia Road', province: 'Gauteng', postalCode: '2196' })
    const { url, headers } = call(fetch)
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ-abc_123?sessionToken=${TOKEN}&languageCode=en&regionCode=za`)
    expect(headers['X-Goog-FieldMask']).toBe('addressComponents,formattedAddress')
  })

  it('turns a refusal, an outage or a missing key into GooglePlacesUnavailableError', async () => {
    stubFetch(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid' } })
    await expect(new GooglePlacesClient(env()).autocomplete('Sandton', TOKEN)).rejects.toBeInstanceOf(GooglePlacesUnavailableError)

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(new GooglePlacesClient(env()).address('abc', TOKEN)).rejects.toBeInstanceOf(GooglePlacesUnavailableError)

    const client = new GooglePlacesClient(env(null))
    expect(client.configured).toBe(false)
    await expect(client.autocomplete('Sandton', TOKEN)).rejects.toBeInstanceOf(GooglePlacesUnavailableError)
  })
})
