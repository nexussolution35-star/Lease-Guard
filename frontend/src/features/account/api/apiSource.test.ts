import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { membership, NEXUS_ID, profileWith } from '@/test/accountFixtures'
import { fakeApiClient, fakeFetch, notFoundFetch, requestAt, urlOf } from '@/test/fakeApi'

import { createApiAccountSource } from './apiSource'

describe('createApiAccountSource', () => {
  it('loads the signed-in user with their memberships from GET /api/v1/me', async () => {
    const profile = profileWith([membership(NEXUS_ID, { isDefault: true, name: 'Nexus Solution' })])
    const fetch = fakeFetch(200, profile)
    expect(await createApiAccountSource(fakeApiClient(fetch)).getCurrentUser()).toEqual(profile)
    expect(urlOf(fetch)).toEqual({ pathname: '/api/v1/me', query: {} })
    expect(requestAt(fetch).headers.get('Authorization')).toBe('Bearer token')
  })

  it('maps 404 (no LeaseGuard profile) to null', async () => {
    expect(await createApiAccountSource(fakeApiClient(notFoundFetch())).getCurrentUser()).toBeNull()
  })

  it('rethrows 401 and other API errors', async () => {
    const fetch = fakeFetch(401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired access token', requestId: 'r1' })
    const error = await createApiAccountSource(fakeApiClient(fetch)).getCurrentUser().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).isUnauthorized).toBe(true)
  })
})
