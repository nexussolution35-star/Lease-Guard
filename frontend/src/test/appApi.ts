import type { ApiClient } from '@leaseguard/api-client'
import { vi } from 'vitest'

import { membership, NEXUS_ID, profileWith, SECOND_ID } from './accountFixtures'
import { fakeApiClient, jsonResponse } from './fakeApi'

/**
 * A fake LeaseGuard API for tests that render the whole app. Use it with
 *
 *   vi.mock('@/services/api/client', async () => ({ getApiClient: (await import('@/test/appApi')).appApiClient }))
 *
 * Responses are keyed by `METHOD /path`; anything else answers 404. `GET /api/v1/me` answers a user
 * with two workspaces (NEXUS_ID is the default) unless a test replaces it.
 */
export const appApi = {
  responses: new Map<string, { status: number; body: unknown }>(),
  requests: [] as Request[],
}

export const DEFAULT_PROFILE = profileWith([
  membership(NEXUS_ID, { isDefault: true, name: 'Test Properties (Pty) Ltd', tradingName: 'Test Properties', initials: 'TP' }),
  membership(SECOND_ID, { name: 'Second Holdings (Pty) Ltd', initials: 'SH' }),
])

export function resetAppApi(): void {
  appApi.responses.clear()
  appApi.requests.length = 0
  respondWith('GET', '/api/v1/me', 200, DEFAULT_PROFILE)
}

export function respondWith(method: string, path: string, status: number, body: unknown): void {
  appApi.responses.set(`${method} ${path}`, { status, body })
}

export function appApiClient(): ApiClient {
  return fakeApiClient(
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const request = input as Request
      appApi.requests.push(request)
      const found = appApi.responses.get(`${request.method} ${new URL(request.url).pathname}`)
      return found
        ? jsonResponse(found.status, found.body)
        : jsonResponse(404, { statusCode: 404, error: 'Not Found', message: 'Not found', requestId: null })
    }),
  )
}

resetAppApi()
