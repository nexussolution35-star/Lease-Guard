import type {
  EntityId,
  KnowledgeDocument,
  KnowledgeDocumentMimeType,
  KnowledgeEntry,
  KnowledgeFaq,
  WhatsAppAgentConfig,
  WhatsAppAgentConfigInput,
} from '@leaseguard/domain'

export type { KnowledgeDocument, KnowledgeEntry, KnowledgeFaq, WhatsAppAgentConfig, WhatsAppAgentConfigInput }

/** The two kinds of written knowledge: FAQs (question and answer) and entries (title and text). */
export type KnowledgeTextKind = 'faq' | 'entry'

/** A new or changed FAQ or entry: `title` is the FAQ's question, `body` its answer (or the entry's text). */
export interface KnowledgeTextInput {
  title: string
  body: string
}

export interface KnowledgeDocumentUpload {
  file: File
  mimeType: KnowledgeDocumentMimeType
  title: string
  description?: string
}

/**
 * The active company's AI agent configuration and knowledge base (`/api/v1/whatsapp/agent…`). Every member reads;
 * company admins change them, which the API enforces. Only approved knowledge ever reaches the agent.
 */
export interface AgentSource {
  getConfig(companyId: EntityId): Promise<WhatsAppAgentConfig>
  saveConfig(companyId: EntityId, input: WhatsAppAgentConfigInput): Promise<WhatsAppAgentConfig>

  listFaqs(companyId: EntityId): Promise<KnowledgeFaq[]>
  listEntries(companyId: EntityId): Promise<KnowledgeEntry[]>
  /** Created as a draft. */
  createText(companyId: EntityId, kind: KnowledgeTextKind, input: KnowledgeTextInput): Promise<KnowledgeFaq | KnowledgeEntry>
  /** A changed approved item becomes a draft again. */
  updateText(companyId: EntityId, kind: KnowledgeTextKind, id: EntityId, input: KnowledgeTextInput): Promise<KnowledgeFaq | KnowledgeEntry>

  listDocuments(companyId: EntityId): Promise<KnowledgeDocument[]>
  /** Signs an upload, sends the file to storage and registers it as a draft document. */
  uploadDocument(companyId: EntityId, upload: KnowledgeDocumentUpload): Promise<KnowledgeDocument>
  /** A short-lived link to the document's file. */
  documentDownloadUrl(companyId: EntityId, id: EntityId): Promise<string>

  /** Approve, return to draft, or delete an item of any kind. */
  review(companyId: EntityId, kind: KnowledgeKind, id: EntityId, action: 'approve' | 'withdraw'): Promise<void>
  remove(companyId: EntityId, kind: KnowledgeKind, id: EntityId): Promise<void>
}

export type KnowledgeKind = KnowledgeTextKind | 'document'
