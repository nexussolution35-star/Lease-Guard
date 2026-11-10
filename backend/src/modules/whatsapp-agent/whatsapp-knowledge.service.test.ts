import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { StorageService } from '../../infrastructure/storage/storage.service'
import { AGENT_KNOWLEDGE_BUCKET, WhatsAppKnowledgeService } from './whatsapp-knowledge.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const OTHER = '6f1d2c1e-0000-4000-8000-000000000002'
const ITEM = '6f1d2c1e-0000-4000-8000-0000000000b1'
const ADMIN = '6f1d2c1e-0000-4000-8000-0000000000a1'
const DOCUMENT = '6f1d2c1e-0000-4000-8000-0000000000d1'

const review = {
  id: ITEM,
  company_id: COMPANY,
  status: 'approved',
  approved_at: '2026-11-11T08:00:00+00:00',
  approved_by_user_id: ADMIN,
  created_by_user_id: ADMIN,
  created_at: '2026-11-10T08:00:00+00:00',
  updated_at: '2026-11-11T08:00:00+00:00',
}
const faqRow = { ...review, question: 'Where do visitors park?', answer: 'Basement P2.' }
const documentRow = {
  ...review,
  id: DOCUMENT,
  status: 'draft',
  approved_at: null,
  approved_by_user_id: null,
  title: 'Leasing brochure',
  description: null,
  file_name: 'brochure.pdf',
  storage_path: `${COMPANY}/${DOCUMENT}/brochure.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 2048,
}

function fakeStorage(overrides: Partial<Record<keyof StorageService, unknown>> = {}) {
  return {
    createSignedUploadUrl: vi.fn(async (_db: unknown, _bucket: string, path: string) => ({ signedUrl: `http://storage/${path}?token=t`, token: 't', path })),
    objectInfo: vi.fn(async () => ({ sizeBytes: 2048, mimeType: 'application/pdf' })),
    createSignedDownloadUrl: vi.fn(async () => 'http://storage/signed'),
    removeObject: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StorageService & Record<string, ReturnType<typeof vi.fn>>
}

function names(q: RecordedQuery): FakeResult | null {
  return q.table === 'profiles' ? { data: [{ id: ADMIN, full_name: 'Thandi Mokoena' }], error: null } : null
}

describe('WhatsAppKnowledgeService: FAQs and entries', () => {
  it("lists the company's FAQs, drafts included, oldest first, with the approver's name", async () => {
    const db = fakeDb((q) => names(q) ?? { data: [faqRow], error: null })
    const faqs = await new WhatsAppKnowledgeService(fakeStorage()).listFaqs(db.client, COMPANY)
    expect(faqs).toEqual([
      {
        id: ITEM,
        companyId: COMPANY,
        status: 'approved',
        approvedAt: '2026-11-11T08:00:00+00:00',
        approvedByUserId: ADMIN,
        approvedByName: 'Thandi Mokoena',
        createdByUserId: ADMIN,
        createdAt: '2026-11-10T08:00:00+00:00',
        updatedAt: '2026-11-11T08:00:00+00:00',
        question: 'Where do visitors park?',
        answer: 'Basement P2.',
      },
    ])
    const q = db.queries[0]!
    expect(q.table).toBe('whatsapp_knowledge_faqs')
    expect(callsTo(q, 'eq')).toEqual([['company_id', COMPANY]])
    expect(callsTo(q, 'order')[0]).toEqual(['created_at', { ascending: true }])
  })

  it('creates a draft with the text only: the database decides the status and the author', async () => {
    const db = fakeDb(() => ({ data: { ...faqRow, status: 'draft', approved_at: null, approved_by_user_id: null }, error: null }))
    const faq = await new WhatsAppKnowledgeService(fakeStorage()).createFaq(db.client, COMPANY, { question: 'Q?', answer: 'A.' })
    expect(faq.status).toBe('draft')
    expect(callsTo(db.queries[0]!, 'insert')).toEqual([[{ company_id: COMPANY, question: 'Q?', answer: 'A.' }]])
  })

  it('changes only the fields sent, scoped to the company; 404 when the company has no such item', async () => {
    const db = fakeDb((q) => names(q) ?? { data: { ...faqRow, status: 'draft', approved_at: null, approved_by_user_id: null, answer: 'Level P1.' }, error: null })
    const faq = await new WhatsAppKnowledgeService(fakeStorage()).updateFaq(db.client, COMPANY, ITEM, { answer: 'Level P1.' })
    expect(faq).toMatchObject({ answer: 'Level P1.', status: 'draft' })
    expect(callsTo(db.queries[0]!, 'update')).toEqual([[{ answer: 'Level P1.' }]])
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', ITEM],
    ])
    const missing = fakeDb(() => ({ data: null, error: null }))
    await expect(new WhatsAppKnowledgeService(fakeStorage()).updateEntry(missing.client, COMPANY, ITEM, { title: 'T' })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('approves and withdraws by setting the status only', async () => {
    const db = fakeDb((q) => names(q) ?? { data: faqRow, error: null })
    const service = new WhatsAppKnowledgeService(fakeStorage())
    await expect(service.setFaqStatus(db.client, COMPANY, ITEM, 'approved')).resolves.toMatchObject({ status: 'approved', approvedByName: 'Thandi Mokoena' })
    expect(callsTo(db.queries[0]!, 'update')).toEqual([[{ status: 'approved' }]])
    await service.setEntryStatus(db.client, COMPANY, ITEM, 'draft')
    const entryUpdate = db.queries.find((q) => q.table === 'whatsapp_knowledge_entries')!
    expect(callsTo(entryUpdate, 'update')).toEqual([[{ status: 'draft' }]])
  })

  it('deletes one item of the company; 404 when there is none', async () => {
    const db = fakeDb(() => ({ data: faqRow, error: null }))
    await new WhatsAppKnowledgeService(fakeStorage()).deleteFaq(db.client, COMPANY, ITEM)
    expect(callsTo(db.queries[0]!, 'delete')).toHaveLength(1)
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', ITEM],
    ])
    const missing = fakeDb(() => ({ data: null, error: null }))
    await expect(new WhatsAppKnowledgeService(fakeStorage()).deleteEntry(missing.client, COMPANY, ITEM)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('WhatsAppKnowledgeService: documents', () => {
  it('signs an upload into the agent-knowledge bucket under <company>/<new document id>/<safe file name>', async () => {
    const storage = fakeStorage()
    const result = await new WhatsAppKnowledgeService(storage).createDocumentUploadUrl(fakeDb(() => ({ data: null, error: null })).client, COMPANY, {
      fileName: 'Leasing brochure (2026).pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    })
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(expect.anything(), AGENT_KNOWLEDGE_BUCKET, `${COMPANY}/${result.documentId}/Leasing-brochure-2026.pdf`)
    expect(result).toMatchObject({ storagePath: `${COMPANY}/${result.documentId}/Leasing-brochure-2026.pdf`, maxSizeBytes: 10 * 1024 * 1024 })
  })

  const register = {
    storagePath: `${COMPANY}/${DOCUMENT}/brochure.pdf`,
    fileName: 'brochure.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: 2048,
    title: 'Leasing brochure',
  }

  it('registers an uploaded file as a draft document with the id from its path', async () => {
    const db = fakeDb(() => ({ data: documentRow, error: null }))
    const document = await new WhatsAppKnowledgeService(fakeStorage()).registerDocument(db.client, COMPANY, register)
    expect(document).toMatchObject({ id: DOCUMENT, status: 'draft', fileName: 'brochure.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
    expect(document).not.toHaveProperty('storagePath')
    expect(callsTo(db.queries[0]!, 'insert')[0]![0]).toEqual({
      id: DOCUMENT,
      company_id: COMPANY,
      title: 'Leasing brochure',
      description: null,
      file_name: 'brochure.pdf',
      storage_path: register.storagePath,
      mime_type: 'application/pdf',
      size_bytes: 2048,
    })
  })

  it("refuses another company's path, a file that is not there and a size that differs", async () => {
    const db = fakeDb(() => ({ data: documentRow, error: null }))
    await expect(
      new WhatsAppKnowledgeService(fakeStorage()).registerDocument(db.client, COMPANY, { ...register, storagePath: `${OTHER}/${DOCUMENT}/brochure.pdf` }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      new WhatsAppKnowledgeService(fakeStorage({ objectInfo: vi.fn(async () => null) })).registerDocument(db.client, COMPANY, register),
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(
      new WhatsAppKnowledgeService(fakeStorage({ objectInfo: vi.fn(async () => ({ sizeBytes: 1, mimeType: 'application/pdf' })) })).registerDocument(db.client, COMPANY, register),
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(db.queries).toHaveLength(0)
  })

  it('refuses a file whose stored media type differs from mimeType, or is not reported', async () => {
    const db = fakeDb(() => ({ data: documentRow, error: null }))
    for (const info of [{ sizeBytes: 2048, mimeType: 'image/png' }, { sizeBytes: 2048 }]) {
      const refused = new WhatsAppKnowledgeService(fakeStorage({ objectInfo: vi.fn(async () => info) })).registerDocument(db.client, COMPANY, register)
      await expect(refused).rejects.toBeInstanceOf(UnprocessableEntityException)
      await expect(refused).rejects.toMatchObject({ response: { message: [expect.stringContaining('mimeType')] } })
    }
    expect(db.queries).toHaveLength(0)
  })

  it('deletes the document and then its file; a file that cannot be removed does not fail the delete', async () => {
    const storage = fakeStorage()
    const db = fakeDb(() => ({ data: documentRow, error: null }))
    await new WhatsAppKnowledgeService(storage).deleteDocument(db.client, COMPANY, DOCUMENT)
    expect(storage.removeObject).toHaveBeenCalledWith(expect.anything(), AGENT_KNOWLEDGE_BUCKET, documentRow.storage_path)

    const failing = fakeStorage({ removeObject: vi.fn(async () => Promise.reject(new Error('storage down'))) })
    await expect(new WhatsAppKnowledgeService(failing).deleteDocument(db.client, COMPANY, DOCUMENT)).resolves.toBeUndefined()
  })

  it("gives a five-minute link to the company's document; 404 for a missing file", async () => {
    const db = fakeDb(() => ({ data: { storage_path: documentRow.storage_path }, error: null }))
    await expect(new WhatsAppKnowledgeService(fakeStorage()).documentDownloadUrl(db.client, COMPANY, DOCUMENT)).resolves.toEqual({
      url: 'http://storage/signed',
      expiresInSeconds: 300,
    })
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', DOCUMENT],
    ])
    await expect(
      new WhatsAppKnowledgeService(fakeStorage({ createSignedDownloadUrl: vi.fn(async () => null) })).documentDownloadUrl(db.client, COMPANY, DOCUMENT),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
