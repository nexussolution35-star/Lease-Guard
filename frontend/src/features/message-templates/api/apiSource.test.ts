import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, TEST_COMPANY_ID, urlOf } from '@/test/fakeApi'

import { createApiMessageTemplateSource } from './apiSource'

const TEMPLATE_ID = '7a1d2c1e-0000-4000-8000-000000000009'

describe('createApiMessageTemplateSource', () => {
  it('reads the settings of the active company', async () => {
    const settings = { whatsappConnected: true, types: [] }
    const fetch = fakeFetch(200, settings)
    await expect(createApiMessageTemplateSource(fakeApiClient(fetch)).getSettings(TEST_COMPANY_ID)).resolves.toEqual(settings)
    expect(urlOf(fetch).pathname).toBe('/api/v1/message-templates')
    expect(requestAt(fetch).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('chooses a template for a message type', async () => {
    const fetch = fakeFetch(200, { messageType: 'monthly_statement', audience: 'tenant', sendable: true })
    await createApiMessageTemplateSource(fakeApiClient(fetch)).choose(TEST_COMPANY_ID, 'monthly_statement', TEMPLATE_ID)
    expect(urlOf(fetch).pathname).toBe('/api/v1/message-templates/monthly_statement')
    expect(requestAt(fetch).method).toBe('PUT')
    expect(requestAt(fetch).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(fetch).json()).toEqual({ whatsappTemplateId: TEMPLATE_ID })
  })

  it('asks for a sync, and passes a refusal on as an ApiError', async () => {
    const fetch = fakeFetch(202, { queued: 1, message: 'Syncing' })
    await expect(createApiMessageTemplateSource(fakeApiClient(fetch)).sync(TEST_COMPANY_ID)).resolves.toEqual({ queued: 1, message: 'Syncing' })
    expect(urlOf(fetch).pathname).toBe('/api/v1/message-templates/sync')
    expect(requestAt(fetch).method).toBe('POST')

    const refused = fakeFetch(409, { statusCode: 409, error: 'Conflict', message: 'Connect a WhatsApp number first', requestId: null })
    await expect(createApiMessageTemplateSource(fakeApiClient(refused)).sync(TEST_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })
})
