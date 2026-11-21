import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, sampleRecord, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiTenantSource } from './apiSource'

const tenant = sampleRecord('tenants')

describe('createApiTenantSource writes', () => {
  it('creates a tenant in the explicit company with the body as given', async () => {
    const fetch = fakeFetch(201, tenant)
    const body = { legalName: 'Soweto Shoes (Pty) Ltd', businessType: 'pty_ltd' as const, primaryContact: { fullName: 'Sizwe Mabena' }, whatsappNumber: '082 555 0199' }
    expect(await createApiTenantSource(fakeApiClient(fetch)).create(TEST_COMPANY_ID, body)).toEqual(tenant)

    const request = requestAt(fetch)
    expect(request.method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe('/api/v1/tenants')
    expect(request.headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await request.json()).toEqual(body)
  })

  it('changes a tenant by id with only the fields sent', async () => {
    const fetch = fakeFetch(200, { ...tenant, whatsappVerified: false })
    const updated = await createApiTenantSource(fakeApiClient(fetch)).update(TEST_COMPANY_ID, TEST_RECORD_ID, { whatsappNumber: '+27825550111' })
    expect(updated.whatsappVerified).toBe(false)

    const request = requestAt(fetch)
    expect(request.method).toBe('PATCH')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/tenants/${TEST_RECORD_ID}`)
    expect(request.headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await request.json()).toEqual({ whatsappNumber: '+27825550111' })
  })

  it('rejects with the API’s message for an invalid number', async () => {
    const message = 'whatsappNumber: Enter the WhatsApp number with its country code, for example +27 82 123 4567'
    const fetch = fakeFetch(400, { statusCode: 400, error: 'Bad Request', message: [message], requestId: 'r1' })
    const error = await createApiTenantSource(fakeApiClient(fetch)).update(TEST_COMPANY_ID, TEST_RECORD_ID, { whatsappNumber: '123' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).messages).toEqual([message])
  })

  it('validates the number the person checked, in the explicit company', async () => {
    const fetch = fakeFetch(200, { ...tenant, whatsappVerified: true, whatsappValidatedAt: '2026-11-20T10:00:00+02:00' })
    const validated = await createApiTenantSource(fakeApiClient(fetch)).validateWhatsApp(TEST_COMPANY_ID, TEST_RECORD_ID, '+27825550111')
    expect(validated.whatsappVerified).toBe(true)

    const request = requestAt(fetch)
    expect(request.method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/tenants/${TEST_RECORD_ID}/whatsapp-validation`)
    expect(request.headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await request.json()).toEqual({ whatsappNumber: '+27825550111' })
  })

  it('rejects with a 409 when the number changed since it was checked', async () => {
    const fetch = fakeFetch(409, { statusCode: 409, error: 'Conflict', message: 'The number changed', requestId: 'r2' })
    const error = await createApiTenantSource(fakeApiClient(fetch)).validateWhatsApp(TEST_COMPANY_ID, TEST_RECORD_ID, '+27825550111').catch((e: unknown) => e)
    expect((error as ApiError).status).toBe(409)
  })
})
