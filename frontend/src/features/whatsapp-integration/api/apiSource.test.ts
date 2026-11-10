import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, TEST_COMPANY_ID, urlOf } from '@/test/fakeApi'

import { createApiWhatsAppIntegrationSource } from './apiSource'

describe('createApiWhatsAppIntegrationSource', () => {
  it('reads the deployment capabilities without a company', async () => {
    const capabilities = { embeddedSignupConfigured: false, webhookConfigured: false, agentRuntimeConfigured: false, workerReporting: false, missing: [] }
    const fetch = fakeFetch(200, capabilities)
    await expect(createApiWhatsAppIntegrationSource(fakeApiClient(fetch)).getCapabilities()).resolves.toEqual(capabilities)
    expect(urlOf(fetch).pathname).toBe('/api/v1/integrations/whatsapp/capabilities')
  })

  it("lists the active company's business accounts with that company in X-Company-Id", async () => {
    const fetch = fakeFetch(200, [])
    await expect(createApiWhatsAppIntegrationSource(fakeApiClient(fetch)).listBusinessAccounts(TEST_COMPANY_ID)).resolves.toEqual([])
    expect(urlOf(fetch).pathname).toBe('/api/v1/integrations/whatsapp/business-accounts')
    expect(requestAt(fetch).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('rethrows API errors', async () => {
    const fetch = fakeFetch(403, { statusCode: 403, error: 'Forbidden', message: 'Not a member', requestId: null })
    await expect(createApiWhatsAppIntegrationSource(fakeApiClient(fetch)).listBusinessAccounts(TEST_COMPANY_ID)).rejects.toBeInstanceOf(ApiError)
  })
})
