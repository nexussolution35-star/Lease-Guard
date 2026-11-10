import { randomUUID } from 'node:crypto'

import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { type EntityId, KNOWLEDGE_DOCUMENT_MAX_BYTES, type KnowledgeDocument, type KnowledgeEntry, type KnowledgeFaq, type KnowledgeStatus } from '@leaseguard/domain'

import { unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { parseStorageObjectPath, storageObjectPath } from '../../infrastructure/storage/storage-paths'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { memberNames } from '../whatsapp-conversations/member-names'
import { approverIds, toDocument, toEntry, toFaq, type DocumentRow, type EntryRow, type FaqRow } from './whatsapp-agent.mapper'
import type {
  CreateDocumentUploadUrlBody,
  CreateEntryBody,
  CreateFaqBody,
  RegisterDocumentBody,
  UpdateDocumentBody,
  UpdateEntryBody,
  UpdateFaqBody,
} from './whatsapp-agent.schemas'

/** The private bucket of knowledge documents (migration 20261111100000): `<company_id>/<document_id>/<file>`. */
export const AGENT_KNOWLEDGE_BUCKET = 'agent-knowledge'

/** How long a document download link works. */
const DOWNLOAD_URL_SECONDS = 300

/** A knowledge base never needs paging in practice; a hard cap keeps one response bounded. */
const LIST_LIMIT = 500

type KnowledgeTable = 'whatsapp_knowledge_faqs' | 'whatsapp_knowledge_entries' | 'whatsapp_knowledge_documents'

export interface KnowledgeDocumentUploadUrl {
  documentId: EntityId
  storagePath: string
  signedUrl: string
  token: string
  maxSizeBytes: number
}

/**
 * The active company's knowledge base for its AI agent (ticket 09): FAQs, knowledge entries and documents, each a
 * draft or approved. Every member reads them; company admins write them (RLS). The database makes every new item a
 * draft, returns changed content to draft and stamps who approved it, so only approved text ever reaches the agent
 * (public.whatsapp_agent_knowledge). Every call runs as the signed-in caller.
 */
@Injectable()
export class WhatsAppKnowledgeService {
  private readonly logger = new Logger(WhatsAppKnowledgeService.name)

  constructor(private readonly storage: StorageService) {}

  // ------------------------------------------------------------------ FAQs
  async listFaqs(db: DbClient, companyId: EntityId): Promise<KnowledgeFaq[]> {
    const rows = await this.list<FaqRow>(db, 'whatsapp_knowledge_faqs', companyId)
    const names = await memberNames(db, approverIds(rows))
    return rows.map((row) => toFaq(row, names))
  }

  async createFaq(db: DbClient, companyId: EntityId, body: CreateFaqBody): Promise<KnowledgeFaq> {
    const row = unwrapDatabase(
      await db.from('whatsapp_knowledge_faqs').insert({ company_id: companyId, question: body.question, answer: body.answer }).select('*').single(),
      'Create FAQ',
    )
    return toFaq(row)
  }

  async updateFaq(db: DbClient, companyId: EntityId, id: EntityId, body: UpdateFaqBody): Promise<KnowledgeFaq> {
    const changes = { ...(body.question !== undefined ? { question: body.question } : {}), ...(body.answer !== undefined ? { answer: body.answer } : {}) }
    const row = await this.updateOne<FaqRow>(db, 'whatsapp_knowledge_faqs', companyId, id, changes, 'Update FAQ')
    return toFaq(row, await memberNames(db, approverIds([row])))
  }

  async setFaqStatus(db: DbClient, companyId: EntityId, id: EntityId, status: KnowledgeStatus): Promise<KnowledgeFaq> {
    const row = await this.updateOne<FaqRow>(db, 'whatsapp_knowledge_faqs', companyId, id, { status }, 'Review FAQ')
    return toFaq(row, await memberNames(db, approverIds([row])))
  }

  async deleteFaq(db: DbClient, companyId: EntityId, id: EntityId): Promise<void> {
    await this.deleteOne(db, 'whatsapp_knowledge_faqs', companyId, id, 'Delete FAQ')
  }

  // ------------------------------------------------------------------ knowledge entries
  async listEntries(db: DbClient, companyId: EntityId): Promise<KnowledgeEntry[]> {
    const rows = await this.list<EntryRow>(db, 'whatsapp_knowledge_entries', companyId)
    const names = await memberNames(db, approverIds(rows))
    return rows.map((row) => toEntry(row, names))
  }

  async createEntry(db: DbClient, companyId: EntityId, body: CreateEntryBody): Promise<KnowledgeEntry> {
    const row = unwrapDatabase(
      await db.from('whatsapp_knowledge_entries').insert({ company_id: companyId, title: body.title, content: body.content }).select('*').single(),
      'Create knowledge entry',
    )
    return toEntry(row)
  }

  async updateEntry(db: DbClient, companyId: EntityId, id: EntityId, body: UpdateEntryBody): Promise<KnowledgeEntry> {
    const changes = { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.content !== undefined ? { content: body.content } : {}) }
    const row = await this.updateOne<EntryRow>(db, 'whatsapp_knowledge_entries', companyId, id, changes, 'Update knowledge entry')
    return toEntry(row, await memberNames(db, approverIds([row])))
  }

  async setEntryStatus(db: DbClient, companyId: EntityId, id: EntityId, status: KnowledgeStatus): Promise<KnowledgeEntry> {
    const row = await this.updateOne<EntryRow>(db, 'whatsapp_knowledge_entries', companyId, id, { status }, 'Review knowledge entry')
    return toEntry(row, await memberNames(db, approverIds([row])))
  }

  async deleteEntry(db: DbClient, companyId: EntityId, id: EntityId): Promise<void> {
    await this.deleteOne(db, 'whatsapp_knowledge_entries', companyId, id, 'Delete knowledge entry')
  }

  // ------------------------------------------------------------------ documents
  async listDocuments(db: DbClient, companyId: EntityId): Promise<KnowledgeDocument[]> {
    const rows = await this.list<DocumentRow>(db, 'whatsapp_knowledge_documents', companyId)
    const names = await memberNames(db, approverIds(rows))
    return rows.map((row) => toDocument(row, names))
  }

  /** A one-time upload target for a new document; register it afterwards with the returned storagePath. */
  async createDocumentUploadUrl(db: DbClient, companyId: EntityId, body: CreateDocumentUploadUrlBody): Promise<KnowledgeDocumentUploadUrl> {
    const documentId = randomUUID()
    const signed = await this.storage.createSignedUploadUrl(db, AGENT_KNOWLEDGE_BUCKET, storageObjectPath(companyId, documentId, body.fileName))
    return { documentId, storagePath: signed.path, signedUrl: signed.signedUrl, token: signed.token, maxSizeBytes: KNOWLEDGE_DOCUMENT_MAX_BYTES }
  }

  /** Registers an uploaded file as a draft document; refused when the file is not there or differs in size or media type. */
  async registerDocument(db: DbClient, companyId: EntityId, body: RegisterDocumentBody): Promise<KnowledgeDocument> {
    const location = parseStorageObjectPath(body.storagePath)
    if (!location || location.companyId !== companyId) {
      throw new BadRequestException('storagePath must be a path returned by createKnowledgeDocumentUploadUrl for the active company')
    }
    const object = await this.storage.objectInfo(db, AGENT_KNOWLEDGE_BUCKET, body.storagePath)
    if (!object) throw new UnprocessableEntityException(['Upload the file to storagePath before registering the document'])
    if (object.sizeBytes !== undefined && object.sizeBytes !== body.sizeBytes) {
      throw new UnprocessableEntityException(['The uploaded file size does not match sizeBytes'])
    }
    // The agent shares documents by this type (ticket 10), so it must be the type Storage holds and serves.
    if (object.mimeType !== body.mimeType) {
      throw new UnprocessableEntityException(['The uploaded file type does not match mimeType; upload it again with that Content-Type'])
    }
    const row = unwrapDatabase(
      await db
        .from('whatsapp_knowledge_documents')
        .insert({
          id: location.entityId,
          company_id: companyId,
          title: body.title,
          description: body.description ? body.description : null,
          file_name: body.fileName,
          storage_path: body.storagePath,
          mime_type: body.mimeType,
          size_bytes: body.sizeBytes,
        })
        .select('*')
        .single(),
      'Register knowledge document',
    )
    return toDocument(row)
  }

  async updateDocument(db: DbClient, companyId: EntityId, id: EntityId, body: UpdateDocumentBody): Promise<KnowledgeDocument> {
    const changes = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description ? body.description : null } : {}),
    }
    const row = await this.updateOne<DocumentRow>(db, 'whatsapp_knowledge_documents', companyId, id, changes, 'Update knowledge document')
    return toDocument(row, await memberNames(db, approverIds([row])))
  }

  async setDocumentStatus(db: DbClient, companyId: EntityId, id: EntityId, status: KnowledgeStatus): Promise<KnowledgeDocument> {
    const row = await this.updateOne<DocumentRow>(db, 'whatsapp_knowledge_documents', companyId, id, { status }, 'Review knowledge document')
    return toDocument(row, await memberNames(db, approverIds([row])))
  }

  /** Deletes the document and then its file (a file left behind is harmless: nothing refers to it). */
  async deleteDocument(db: DbClient, companyId: EntityId, id: EntityId): Promise<void> {
    const row = await this.deleteOne(db, 'whatsapp_knowledge_documents', companyId, id, 'Delete knowledge document')
    const path = (row as { storage_path?: string }).storage_path
    if (!path) return
    try {
      await this.storage.removeObject(db, AGENT_KNOWLEDGE_BUCKET, path)
    } catch (error) {
      this.logger.warn(`Knowledge document ${id} deleted; its file could not be removed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** A short-lived link to read the document's file (members of the company). */
  async documentDownloadUrl(db: DbClient, companyId: EntityId, id: EntityId): Promise<{ url: string; expiresInSeconds: number }> {
    const row = unwrapDatabase(
      await db.from('whatsapp_knowledge_documents').select('storage_path').eq('company_id', companyId).eq('id', id).maybeSingle(),
      'Load knowledge document',
    )
    const url = await this.storage.createSignedDownloadUrl(db, AGENT_KNOWLEDGE_BUCKET, row.storage_path, DOWNLOAD_URL_SECONDS)
    if (!url) throw new NotFoundException('The document file was not found')
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS }
  }

  // ------------------------------------------------------------------ shared
  private async list<Row>(db: DbClient, table: KnowledgeTable, companyId: EntityId): Promise<Row[]> {
    const rows = unwrapDatabase(
      await db.from(table).select('*').eq('company_id', companyId).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(LIST_LIMIT),
      'List knowledge',
    )
    return rows as unknown as Row[]
  }

  /** Updates one item of the company; 404 when it has none with this id (RLS also hides other companies' rows). */
  private async updateOne<Row>(db: DbClient, table: KnowledgeTable, companyId: EntityId, id: EntityId, changes: Record<string, unknown>, operation: string): Promise<Row> {
    const row = unwrapDatabase(
      await db.from(table).update(changes as never).eq('company_id', companyId).eq('id', id).select('*').maybeSingle(),
      operation,
    )
    return row as unknown as Row
  }

  /** Deletes one item of the company and returns it; 404 when there is none. */
  private async deleteOne(db: DbClient, table: KnowledgeTable, companyId: EntityId, id: EntityId, operation: string): Promise<unknown> {
    return unwrapDatabase(await db.from(table).delete().eq('company_id', companyId).eq('id', id).select('*').maybeSingle(), operation)
  }
}
