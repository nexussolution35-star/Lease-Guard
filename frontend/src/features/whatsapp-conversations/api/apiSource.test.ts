import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, notFoundFetch, requestAt, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiConversationSource } from './apiSource'

describe('createApiConversationSource', () => {
  it("lists the active company's conversations with that company in X-Company-Id", async () => {
    const fetch = fakeFetch(200, { items: [], total: 0, page: 2, pageSize: 25 })
    await expect(createApiConversationSource(fakeApiClient(fetch)).list(TEST_COMPANY_ID, { page: 2, pageSize: 25 })).resolves.toMatchObject({ page: 2 })
    expect(urlOf(fetch)).toEqual({ pathname: '/api/v1/whatsapp/conversations', query: { page: '2', pageSize: '25' } })
    expect(requestAt(fetch).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('reads one conversation, and null when the company does not have it', async () => {
    const fetch = fakeFetch(200, { id: TEST_RECORD_ID, messages: [] })
    await expect(createApiConversationSource(fakeApiClient(fetch)).get(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toMatchObject({ id: TEST_RECORD_ID })
    expect(urlOf(fetch).pathname).toBe(`/api/v1/whatsapp/conversations/${TEST_RECORD_ID}`)
    await expect(createApiConversationSource(fakeApiClient(notFoundFetch())).get(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toBeNull()
    await expect(createApiConversationSource(fakeApiClient(fakeFetch(200, {}))).get(TEST_COMPANY_ID, 'not-a-uuid')).resolves.toBeNull()
  })

  it('rethrows other API errors', async () => {
    const fetch = fakeFetch(403, { statusCode: 403, error: 'Forbidden', message: 'Not a member', requestId: null })
    await expect(createApiConversationSource(fakeApiClient(fetch)).list(TEST_COMPANY_ID, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ApiError)
  })
})
