import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import {
  fakeApiClient,
  fakeFetch,
  forbiddenFetch,
  notFoundFetch,
  requestAt,
  sampleRecord,
  TEST_COMPANY_ID,
  TEST_FILTER_ID,
  TEST_RECORD_ID,
  urlOf,
  type FakeFetch,
} from '@/test/fakeApi'

import { createApiCommunicationSource } from './apiSource'

const communication = sampleRecord('communications')

function sourceWith(fetch: FakeFetch) {
  return createApiCommunicationSource(fakeApiClient(fetch))
}

describe('createApiCommunicationSource', () => {
  it('lists with the explicit company and every set parameter, exactly as the endpoint accepts them', async () => {
    const fetch = fakeFetch(200, { items: [communication], total: 1, page: 2, pageSize: 10 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 2, pageSize: 10, search: ' needle ', sort: 'sentAt', direction: 'desc', status: 'pending_approval', messageType: 'overdue_payment_reminder', recipientType: 'tenant', channel: 'whatsapp', tenantId: TEST_FILTER_ID, propertyId: TEST_FILTER_ID })

    expect(page).toEqual({ items: [communication], total: 1, page: 2, pageSize: 10 })
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/communications',
      query: { page: '2', pageSize: '10', search: 'needle', sort: 'sentAt', direction: 'desc', status: 'pending_approval', messageType: 'overdue_payment_reminder', recipientType: 'tenant', channel: 'whatsapp', tenantId: TEST_FILTER_ID, propertyId: TEST_FILTER_ID },
    })
    // The company in the query key wins over the client's default company.
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(requestAt(fetch).headers.get('Authorization')).toBe('Bearer token')
  })

  it('sends only paging when no search, sort or filter is set', async () => {
    const fetch = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 })
    await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 1, pageSize: 25, search: '  ' })
    expect(urlOf(fetch).query).toEqual({ page: '1', pageSize: '25' })
  })

  it('gets one record by id and maps 404 to null', async () => {
    const found = fakeFetch(200, communication)
    expect(await sourceWith(found).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(communication)
    expect(urlOf(found).pathname).toBe(`/api/v1/communications/${TEST_RECORD_ID}`)
    expect(requestAt(found).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    expect(await sourceWith(notFoundFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('answers not found for non-UUID ids without calling the API', async () => {
    const fetch = fakeFetch(200, communication)
    expect(await sourceWith(fetch).get(TEST_COMPANY_ID, 'demo_record_id')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rethrows other API errors', async () => {
    const error = await sourceWith(forbiddenFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
    const listError = await sourceWith(forbiddenFetch()).list(TEST_COMPANY_ID, { page: 1, pageSize: 25 }).catch((e: unknown) => e)
    expect((listError as ApiError).status).toBe(403)
  })

  it('lists pending approvals for the active company, oldest request first unless asked otherwise', async () => {
    const pending = { approval: { id: TEST_FILTER_ID }, communication }
    const fetch = fakeFetch(200, { items: [pending], total: 1, page: 2, pageSize: 10 })
    await expect(sourceWith(fetch).listPendingApprovals(TEST_COMPANY_ID, { page: 2, pageSize: 10 })).resolves.toEqual({ items: [pending], total: 1, page: 2, pageSize: 10 })
    expect(urlOf(fetch)).toEqual({ pathname: '/api/v1/communications/approvals', query: { page: '2', pageSize: '10' } })
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('approves with an optional note and rejects with a reason, for the active company', async () => {
    const decided = { approval: { id: TEST_FILTER_ID, decision: 'approved' }, communication }
    const approve = fakeFetch(200, decided)
    await expect(sourceWith(approve).approve(TEST_COMPANY_ID, TEST_RECORD_ID)).resolves.toEqual(decided)
    expect(urlOf(approve).pathname).toBe(`/api/v1/communications/${TEST_RECORD_ID}/approve`)
    expect(requestAt(approve).method).toBe('POST')
    expect(requestAt(approve).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(approve).json()).toEqual({})

    const approveWithNote = fakeFetch(200, decided)
    await sourceWith(approveWithNote).approve(TEST_COMPANY_ID, TEST_RECORD_ID, 'Checked against the statement')
    expect(await requestAt(approveWithNote).json()).toEqual({ note: 'Checked against the statement' })

    const reject = fakeFetch(200, { ...decided, approval: { id: TEST_FILTER_ID, decision: 'rejected' } })
    await sourceWith(reject).reject(TEST_COMPANY_ID, TEST_RECORD_ID, 'Wrong statement month')
    expect(urlOf(reject).pathname).toBe(`/api/v1/communications/${TEST_RECORD_ID}/reject`)
    expect(requestAt(reject).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(reject).json()).toEqual({ note: 'Wrong statement month' })
  })

  it('rethrows a refused approval with every deliverability blocker', async () => {
    const fetch = fakeFetch(422, { statusCode: 422, error: 'Unprocessable Entity', message: ['The company WhatsApp account is not connected', 'WhatsApp template "statement" is not approved by Meta'], requestId: null })
    await expect(sourceWith(fetch).approve(TEST_COMPANY_ID, TEST_RECORD_ID)).rejects.toMatchObject({
      status: 422,
      messages: ['The company WhatsApp account is not connected', 'WhatsApp template "statement" is not approved by Meta'],
    })
  })
  it('reads the analytics for the explicit company and range, and only the dates that are set', async () => {
    const figures = { from: '2026-10-01', to: '2026-10-31', inbound: 3, outbound: 2, delivered: 2, read: 1, failed: 0, handovers: 1, agentHandovers: 1, agentReplies: 1, outOfHoursMessages: 0, suggestedReplies: 1 }
    const fetch = fakeFetch(200, figures)
    expect(await sourceWith(fetch).analytics(TEST_COMPANY_ID, { from: '2026-10-01', to: '2026-10-31' })).toEqual(figures)
    expect(urlOf(fetch)).toEqual({ pathname: '/api/v1/communications/analytics', query: { from: '2026-10-01', to: '2026-10-31' } })
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    const defaults = fakeFetch(200, figures)
    await sourceWith(defaults).analytics(TEST_COMPANY_ID, {})
    expect(urlOf(defaults).query).toEqual({})

    await expect(sourceWith(forbiddenFetch()).analytics(TEST_COMPANY_ID, {})).rejects.toBeInstanceOf(ApiError)
  })
})
