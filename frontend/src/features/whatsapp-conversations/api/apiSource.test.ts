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

  it('asks for a filtered view', async () => {
    const fetch = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 })
    await createApiConversationSource(fakeApiClient(fetch)).list(TEST_COMPANY_ID, { page: 1, pageSize: 25, filter: 'mine' })
    expect(urlOf(fetch).query).toEqual({ page: '1', pageSize: '25', filter: 'mine' })
  })

  it('accepts, assigns and resolves handovers and replies, for the active company', async () => {
    const handover = { id: 'h1', status: 'accepted' }
    const accept = fakeFetch(200, handover)
    await expect(createApiConversationSource(fakeApiClient(accept)).acceptHandover(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toEqual(handover)
    expect(urlOf(accept).pathname).toBe(`/api/v1/whatsapp/conversations/${TEST_RECORD_ID}/handover/accept`)
    expect(requestAt(accept).method).toBe('POST')
    expect(requestAt(accept).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)

    const assign = fakeFetch(200, handover)
    await createApiConversationSource(fakeApiClient(assign)).assignHandover(TEST_COMPANY_ID, TEST_RECORD_ID, 'u1')
    expect(urlOf(assign).pathname).toBe(`/api/v1/whatsapp/conversations/${TEST_RECORD_ID}/handover/assign`)
    expect(await requestAt(assign).json()).toEqual({ userId: 'u1' })

    const resolve = fakeFetch(200, handover)
    await createApiConversationSource(fakeApiClient(resolve)).resolveHandover(TEST_COMPANY_ID, TEST_RECORD_ID, 'Done')
    expect(urlOf(resolve).pathname).toBe(`/api/v1/whatsapp/conversations/${TEST_RECORD_ID}/handover/resolve`)
    expect(await requestAt(resolve).json()).toEqual({ note: 'Done' })

    const reply = fakeFetch(201, { id: 'm1' })
    await createApiConversationSource(fakeApiClient(reply)).reply(TEST_COMPANY_ID, TEST_RECORD_ID, 'Hello')
    expect(urlOf(reply).pathname).toBe(`/api/v1/whatsapp/conversations/${TEST_RECORD_ID}/replies`)
    expect(await requestAt(reply).json()).toEqual({ body: 'Hello' })
  })

  it('rethrows a refused reply with its reasons', async () => {
    const fetch = fakeFetch(422, { statusCode: 422, error: 'Unprocessable Entity', message: ['Reply window closed'], requestId: null })
    await expect(createApiConversationSource(fakeApiClient(fetch)).reply(TEST_COMPANY_ID, TEST_RECORD_ID, 'Hi')).rejects.toMatchObject({ status: 422, messages: ['Reply window closed'] })
  })
})
