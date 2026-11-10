import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it, vi } from 'vitest'

import { fakeApiClient, fakeFetch, jsonResponse, requestAt, TEST_COMPANY_ID, TEST_RECORD_ID, urlOf } from '@/test/fakeApi'

import { createApiAgentSource, DocumentUploadError } from './apiSource'

const CONFIG_INPUT = {
  agentName: 'Atlas assistant',
  businessDescription: '',
  tone: '',
  timezone: 'Africa/Johannesburg',
  operatingHours: [],
  languages: ['en' as const],
  policies: '',
  supportInstructions: '',
  escalationRules: '',
  permittedActions: [],
  autoReplyEnabled: false,
  handoverContactUserIds: [],
}

describe('createApiAgentSource', () => {
  it("reads and saves the active company's agent configuration", async () => {
    const get = fakeFetch(200, { companyId: TEST_COMPANY_ID, configured: false })
    await expect(createApiAgentSource(fakeApiClient(get)).getConfig(TEST_COMPANY_ID)).resolves.toMatchObject({ configured: false })
    expect(urlOf(get).pathname).toBe('/api/v1/whatsapp/agent')
    expect(requestAt(get).headers.get('X-Company-Id')).toBe(TEST_COMPANY_ID)

    const put = fakeFetch(200, { companyId: TEST_COMPANY_ID, configured: true })
    await createApiAgentSource(fakeApiClient(put)).saveConfig(TEST_COMPANY_ID, CONFIG_INPUT)
    expect(requestAt(put).method).toBe('PUT')
    expect(await requestAt(put).json()).toEqual(CONFIG_INPUT)
  })

  it('maps FAQs and entries to their endpoints', async () => {
    const faq = fakeFetch(201, { id: TEST_RECORD_ID, status: 'draft' })
    await createApiAgentSource(fakeApiClient(faq)).createText(TEST_COMPANY_ID, 'faq', { title: 'Parking?', body: 'Basement.' })
    expect(urlOf(faq).pathname).toBe('/api/v1/whatsapp/agent/faqs')
    expect(await requestAt(faq).json()).toEqual({ question: 'Parking?', answer: 'Basement.' })

    const entry = fakeFetch(200, { id: TEST_RECORD_ID, status: 'draft' })
    await createApiAgentSource(fakeApiClient(entry)).updateText(TEST_COMPANY_ID, 'entry', TEST_RECORD_ID, { title: 'Hours', body: '08:00–17:00' })
    expect(requestAt(entry).method).toBe('PATCH')
    expect(urlOf(entry).pathname).toBe(`/api/v1/whatsapp/agent/knowledge-entries/${TEST_RECORD_ID}`)
    expect(await requestAt(entry).json()).toEqual({ title: 'Hours', content: '08:00–17:00' })
  })

  it('approves, withdraws and deletes each kind', async () => {
    const approve = fakeFetch(200, {})
    await createApiAgentSource(fakeApiClient(approve)).review(TEST_COMPANY_ID, 'faq', TEST_RECORD_ID, 'approve')
    expect(urlOf(approve).pathname).toBe(`/api/v1/whatsapp/agent/faqs/${TEST_RECORD_ID}/approve`)
    const withdraw = fakeFetch(200, {})
    await createApiAgentSource(fakeApiClient(withdraw)).review(TEST_COMPANY_ID, 'document', TEST_RECORD_ID, 'withdraw')
    expect(urlOf(withdraw).pathname).toBe(`/api/v1/whatsapp/agent/documents/${TEST_RECORD_ID}/withdraw`)
    const remove = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    await createApiAgentSource(fakeApiClient(remove)).remove(TEST_COMPANY_ID, 'entry', TEST_RECORD_ID)
    expect(requestAt(remove).method).toBe('DELETE')
    expect(urlOf(remove).pathname).toBe(`/api/v1/whatsapp/agent/knowledge-entries/${TEST_RECORD_ID}`)
  })

  it('signs the upload, sends the file to storage, then registers it as a draft', async () => {
    const api = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL((input as Request).url)
      if (url.pathname.endsWith('/upload-url')) {
        return jsonResponse(200, { documentId: TEST_RECORD_ID, storagePath: `${TEST_COMPANY_ID}/${TEST_RECORD_ID}/rules.pdf`, signedUrl: 'http://storage/upload?token=t', token: 't', maxSizeBytes: 10 })
      }
      return jsonResponse(201, { id: TEST_RECORD_ID, status: 'draft' })
    })
    const storage = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))
    const file = new File(['%PDF-1.7'], 'rules.pdf', { type: 'application/pdf' })
    await createApiAgentSource(fakeApiClient(api), storage).uploadDocument(TEST_COMPANY_ID, { file, mimeType: 'application/pdf', title: 'House rules' })

    expect(await requestAt(api, 0).json()).toEqual({ fileName: 'rules.pdf', mimeType: 'application/pdf', sizeBytes: file.size })
    expect(storage).toHaveBeenCalledWith('http://storage/upload?token=t', expect.objectContaining({ method: 'PUT', body: file }))
    expect(urlOf(api, 1).pathname).toBe('/api/v1/whatsapp/agent/documents')
    expect(await requestAt(api, 1).json()).toEqual({
      fileName: 'rules.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      storagePath: `${TEST_COMPANY_ID}/${TEST_RECORD_ID}/rules.pdf`,
      title: 'House rules',
    })
  })

  it('stops when storage refuses the file, and rethrows API errors', async () => {
    const api = fakeFetch(200, { documentId: TEST_RECORD_ID, storagePath: 'p', signedUrl: 'http://storage/upload', token: 't', maxSizeBytes: 10 })
    const refused = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 400 }))
    const file = new File(['x'], 'x.txt', { type: 'text/plain' })
    await expect(createApiAgentSource(fakeApiClient(api), refused).uploadDocument(TEST_COMPANY_ID, { file, mimeType: 'text/plain', title: 'X' })).rejects.toBeInstanceOf(
      DocumentUploadError,
    )
    expect(api).toHaveBeenCalledTimes(1)

    const forbidden = fakeFetch(403, { statusCode: 403, error: 'Forbidden', message: 'Not allowed', requestId: null })
    await expect(createApiAgentSource(fakeApiClient(forbidden)).saveConfig(TEST_COMPANY_ID, CONFIG_INPUT)).rejects.toBeInstanceOf(ApiError)
  })
})
