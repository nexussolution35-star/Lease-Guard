import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { KnowledgeDocument, KnowledgeEntry, KnowledgeFaq, WhatsAppAgentConfig } from '@leaseguard/domain'

import type { AgentSource } from './source'

/** Thrown when the file could not be sent to storage after the API signed the upload. */
export class DocumentUploadError extends Error {
  constructor(status: number) {
    super(`The file could not be uploaded (storage answered ${status}). Try again.`)
    this.name = 'DocumentUploadError'
  }
}

/**
 * The AI agent and knowledge base from the LeaseGuard API (`/api/v1/whatsapp/agent…`). A document's file goes
 * straight to storage with the signed URL the API returns (`upload` is the browser's fetch, replaceable in tests).
 */
export function createApiAgentSource(api: ApiClient, upload: typeof fetch = (...args) => globalThis.fetch(...args)): AgentSource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  return {
    async getConfig(companyId) {
      const config: WhatsAppAgentConfig = await unwrap(api.GET('/api/v1/whatsapp/agent', { headers: scoped(companyId) }))
      return config
    },

    async saveConfig(companyId, input) {
      const config: WhatsAppAgentConfig = await unwrap(api.PUT('/api/v1/whatsapp/agent', { body: input, headers: scoped(companyId) }))
      return config
    },

    async listFaqs(companyId) {
      const faqs: KnowledgeFaq[] = await unwrap(api.GET('/api/v1/whatsapp/agent/faqs', { headers: scoped(companyId) }))
      return faqs
    },

    async listEntries(companyId) {
      const entries: KnowledgeEntry[] = await unwrap(api.GET('/api/v1/whatsapp/agent/knowledge-entries', { headers: scoped(companyId) }))
      return entries
    },

    async createText(companyId, kind, input) {
      if (kind === 'faq') {
        const faq: KnowledgeFaq = await unwrap(
          api.POST('/api/v1/whatsapp/agent/faqs', { body: { question: input.title, answer: input.body }, headers: scoped(companyId) }),
        )
        return faq
      }
      const entry: KnowledgeEntry = await unwrap(
        api.POST('/api/v1/whatsapp/agent/knowledge-entries', { body: { title: input.title, content: input.body }, headers: scoped(companyId) }),
      )
      return entry
    },

    async updateText(companyId, kind, id, input) {
      if (kind === 'faq') {
        const faq: KnowledgeFaq = await unwrap(
          api.PATCH('/api/v1/whatsapp/agent/faqs/{faqId}', {
            params: { path: { faqId: id } },
            body: { question: input.title, answer: input.body },
            headers: scoped(companyId),
          }),
        )
        return faq
      }
      const entry: KnowledgeEntry = await unwrap(
        api.PATCH('/api/v1/whatsapp/agent/knowledge-entries/{entryId}', {
          params: { path: { entryId: id } },
          body: { title: input.title, content: input.body },
          headers: scoped(companyId),
        }),
      )
      return entry
    },

    async listDocuments(companyId) {
      const documents: KnowledgeDocument[] = await unwrap(api.GET('/api/v1/whatsapp/agent/documents', { headers: scoped(companyId) }))
      return documents
    },

    async uploadDocument(companyId, { file, mimeType, title, description }) {
      const details = { fileName: file.name, mimeType, sizeBytes: file.size }
      const target = await unwrap(api.POST('/api/v1/whatsapp/agent/documents/upload-url', { body: details, headers: scoped(companyId) }))
      const sent = await upload(target.signedUrl, { method: 'PUT', headers: { 'content-type': mimeType }, body: file })
      if (!sent.ok) throw new DocumentUploadError(sent.status)
      const document: KnowledgeDocument = await unwrap(
        api.POST('/api/v1/whatsapp/agent/documents', {
          body: { ...details, storagePath: target.storagePath, title, ...(description ? { description } : {}) },
          headers: scoped(companyId),
        }),
      )
      return document
    },

    async documentDownloadUrl(companyId, id) {
      const link = await unwrap(
        api.GET('/api/v1/whatsapp/agent/documents/{documentId}/download-url', { params: { path: { documentId: id } }, headers: scoped(companyId) }),
      )
      return link.url
    },

    async review(companyId, kind, id, action) {
      const headers = scoped(companyId)
      if (kind === 'faq') {
        const params = { path: { faqId: id } }
        await unwrap(
          action === 'approve'
            ? api.POST('/api/v1/whatsapp/agent/faqs/{faqId}/approve', { params, headers })
            : api.POST('/api/v1/whatsapp/agent/faqs/{faqId}/withdraw', { params, headers }),
        )
      } else if (kind === 'entry') {
        const params = { path: { entryId: id } }
        await unwrap(
          action === 'approve'
            ? api.POST('/api/v1/whatsapp/agent/knowledge-entries/{entryId}/approve', { params, headers })
            : api.POST('/api/v1/whatsapp/agent/knowledge-entries/{entryId}/withdraw', { params, headers }),
        )
      } else {
        const params = { path: { documentId: id } }
        await unwrap(
          action === 'approve'
            ? api.POST('/api/v1/whatsapp/agent/documents/{documentId}/approve', { params, headers })
            : api.POST('/api/v1/whatsapp/agent/documents/{documentId}/withdraw', { params, headers }),
        )
      }
    },

    async remove(companyId, kind, id) {
      const headers = scoped(companyId)
      if (kind === 'faq') await unwrap(api.DELETE('/api/v1/whatsapp/agent/faqs/{faqId}', { params: { path: { faqId: id } }, headers }))
      else if (kind === 'entry') await unwrap(api.DELETE('/api/v1/whatsapp/agent/knowledge-entries/{entryId}', { params: { path: { entryId: id } }, headers }))
      else await unwrap(api.DELETE('/api/v1/whatsapp/agent/documents/{documentId}', { params: { path: { documentId: id } }, headers }))
    },
  }
}
