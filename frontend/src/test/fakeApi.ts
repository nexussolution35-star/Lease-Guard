import { createApiClient, type ApiClient } from '@leaseguard/api-client'
import { vi, type Mock } from 'vitest'

import { SAMPLE_RECORDS, type SampleRecords } from './sampleRecords'

/** UUIDs for API-source tests (the API only accepts UUID ids). */
export const TEST_COMPANY_ID = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
export const TEST_RECORD_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
export const TEST_FILTER_ID = '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10'

export type FakeFetch = Mock<typeof globalThis.fetch>

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fetch that answers every request with the same JSON response. */
export function fakeFetch(status: number, body: unknown): FakeFetch {
  return vi.fn<typeof globalThis.fetch>(async () => jsonResponse(status, body))
}

export function notFoundFetch(): FakeFetch {
  return fakeFetch(404, { statusCode: 404, error: 'Not Found', message: 'Not found', requestId: 'req-404' })
}

export function forbiddenFetch(): FakeFetch {
  return fakeFetch(403, { statusCode: 403, error: 'Forbidden', message: 'You do not have access to this company', requestId: null })
}

/** The nth request a fake fetch received (openapi-fetch passes a Request object). */
export function requestAt(fetch: FakeFetch, index = 0): Request {
  const request = fetch.mock.calls[index]?.[0]
  if (!(request instanceof Request)) throw new Error(`expected request #${index} to be a Request`)
  return request
}

/** Path and query parameters of the nth request. */
export function urlOf(fetch: FakeFetch, index = 0): { pathname: string; query: Record<string, string> } {
  const url = new URL(requestAt(fetch, index).url)
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams) }
}

/**
 * An API client on a fake fetch. Its default company is deliberately different from the one sources
 * pass, so tests prove that the explicit company (the one in the query key) is sent.
 */
export function fakeApiClient(fetch: FakeFetch): ApiClient {
  return createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'token', getCompanyId: () => 'other-company', fetch })
}

/** One realistic record of a kind, used as a response body (a fresh copy per call). */
export function sampleRecord<K extends keyof SampleRecords>(key: K): SampleRecords[K] {
  return structuredClone(SAMPLE_RECORDS[key])
}
