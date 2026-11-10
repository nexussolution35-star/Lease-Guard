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

  it('starts an onboarding session and completes it for the active company', async () => {
    const start = fakeFetch(201, { sessionId: 's-1' })
    await createApiWhatsAppIntegrationSource(fakeApiClient(start)).startOnboarding(TEST_COMPANY_ID)
    expect(urlOf(start).pathname).toBe('/api/v1/integrations/whatsapp/onboarding-sessions')
    expect(requestAt(start).method).toBe('POST')
    expect(requestAt(start).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)

    const complete = fakeFetch(200, { status: 'cancelled' })
    const completion = { state: 'a'.repeat(64), event: 'CANCEL' as const, sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' } }
    await createApiWhatsAppIntegrationSource(fakeApiClient(complete)).completeOnboarding(TEST_COMPANY_ID, 's-1', completion)
    expect(urlOf(complete).pathname).toBe('/api/v1/integrations/whatsapp/onboarding-sessions/s-1/complete')
    expect(requestAt(complete).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(complete).json()).toEqual(completion)
  })

  it('verifies, registers and disconnects a number of the active company, and lists its templates', async () => {
    const verify = fakeFetch(202, { numberId: 'n-1', status: 'queued', message: 'Verifying' })
    await createApiWhatsAppIntegrationSource(fakeApiClient(verify)).verifyNumber(TEST_COMPANY_ID, 'n-1')
    expect([requestAt(verify).method, urlOf(verify).pathname]).toEqual(['POST', '/api/v1/integrations/whatsapp/numbers/n-1/verify'])
    expect(requestAt(verify).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)

    const register = fakeFetch(202, { numberId: 'n-1', status: 'queued', message: 'Registering' })
    await createApiWhatsAppIntegrationSource(fakeApiClient(register)).registerNumber(TEST_COMPANY_ID, 'n-1', '123456')
    expect(urlOf(register).pathname).toBe('/api/v1/integrations/whatsapp/numbers/n-1/register')
    expect(await requestAt(register).json()).toEqual({ pin: '123456' })

    const disconnect = fakeFetch(200, { numberId: 'n-1', status: 'disconnected', tokenRemoved: true, message: 'Done' })
    await expect(createApiWhatsAppIntegrationSource(fakeApiClient(disconnect)).disconnectNumber(TEST_COMPANY_ID, 'n-1')).resolves.toMatchObject({ tokenRemoved: true })
    expect(urlOf(disconnect).pathname).toBe('/api/v1/integrations/whatsapp/numbers/n-1/disconnect')

    const templates = fakeFetch(200, [])
    await createApiWhatsAppIntegrationSource(fakeApiClient(templates)).listMessageTemplates(TEST_COMPANY_ID)
    expect(urlOf(templates).pathname).toBe('/api/v1/integrations/whatsapp/message-templates')
    expect(requestAt(templates).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)
  })

  it('rethrows API errors', async () => {
    const fetch = fakeFetch(403, { statusCode: 403, error: 'Forbidden', message: 'Not a member', requestId: null })
    await expect(createApiWhatsAppIntegrationSource(fakeApiClient(fetch)).listBusinessAccounts(TEST_COMPANY_ID)).rejects.toBeInstanceOf(ApiError)
  })
})
