import { createHash, randomUUID } from 'node:crypto'

import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common'
import { LEASE_DOCUMENT_MAX_BYTES, type EntityId, type LeaseDocument } from '@leaseguard/domain'

import { unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { parseStorageObjectPath, storageObjectPath } from '../../infrastructure/storage/storage-paths'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { toLeaseDocument } from './lease-documents.mapper'
import type { CreateLeaseDocumentUploadUrlBody, RegisterLeaseDocumentBody } from './lease-documents.schemas'

/** Most documents one lease lists; a lease carries a handful (signed lease, renewals, guarantee, receipts, FICA). */
export const MAX_LEASE_DOCUMENTS = 200

/** How long a document download link works. */
export const LEASE_DOCUMENT_DOWNLOAD_SECONDS = 300

/** Every PDF starts with this header (ISO 32000); a file without it is not a PDF whatever its name or Content-Type. */
const PDF_MAGIC = new TextEncoder().encode('%PDF-')

/** Where and how the browser uploads a lease document before recording it. */
export interface LeaseDocumentUploadUrl {
  documentId: EntityId
  storagePath: string
  signedUrl: string
  token: string
  maxSizeBytes: number
}

export interface LeaseDocumentDownloadUrl {
  url: string
  expiresInSeconds: number
}

/**
 * The documents of one lease of the active company, in the private lease-documents bucket at
 * `<companyId>/<documentId>/<file>`: (1) sign an upload, (2) record the uploaded PDF, (3) list, (4) sign a short-lived
 * download. Every call runs with the caller's RLS-bound client and an explicit company filter, so database and storage
 * policies apply; the database stamps the uploader and writes the audit entry.
 */
@Injectable()
export class LeaseDocumentsService {
  constructor(private readonly storage: StorageService) {}

  /** Newest first. 404 when the lease is not in the company, so an empty list always means "no documents". */
  async list(db: DbClient, companyId: EntityId, leaseId: EntityId): Promise<LeaseDocument[]> {
    await this.assertLease(db, companyId, leaseId)
    const rows = unwrapDatabase(
      await db
        .from('lease_documents')
        .select('*')
        .eq('company_id', companyId)
        .eq('lease_id', leaseId)
        .order('uploaded_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(MAX_LEASE_DOCUMENTS),
      'List lease documents',
    )
    return rows.map(toLeaseDocument)
  }

  /** A one-time upload target for a new PDF of the lease; 413 above the size limit, 404 for a lease not in the company. */
  async createUploadUrl(db: DbClient, companyId: EntityId, leaseId: EntityId, body: CreateLeaseDocumentUploadUrlBody): Promise<LeaseDocumentUploadUrl> {
    assertSize(body.sizeBytes)
    await this.assertLease(db, companyId, leaseId)
    const documentId = randomUUID()
    const signed = await this.storage.createSignedUploadUrl(db, this.storage.leaseDocumentsBucket, storageObjectPath(companyId, documentId, body.fileName))
    return { documentId, storagePath: signed.path, signedUrl: signed.signedUrl, token: signed.token, maxSizeBytes: LEASE_DOCUMENT_MAX_BYTES }
  }

  /**
   * Records an uploaded file as a document of the lease. The stored object must be there, be the size the client
   * sent, be stored as a PDF and start with the PDF header (422 otherwise); its SHA-256 is computed here from the
   * stored bytes. A path already recorded is refused with 409.
   */
  async register(db: DbClient, companyId: EntityId, userId: EntityId, leaseId: EntityId, body: RegisterLeaseDocumentBody): Promise<LeaseDocument> {
    assertSize(body.sizeBytes)
    const location = parseStorageObjectPath(body.storagePath)
    if (!location || location.companyId !== companyId) {
      throw new BadRequestException('storagePath must be a path returned by createLeaseDocumentUploadUrl for the active company')
    }
    await this.assertLease(db, companyId, leaseId)

    const bucket = this.storage.leaseDocumentsBucket
    const object = await this.storage.objectInfo(db, bucket, body.storagePath)
    if (!object) throw new UnprocessableEntityException('Upload the file to storagePath before recording the document')
    if (object.sizeBytes !== undefined && object.sizeBytes !== body.sizeBytes) {
      throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    }
    if (object.mimeType !== undefined && object.mimeType !== body.mimeType) {
      throw new UnprocessableEntityException('The uploaded file is not stored as a PDF; upload it again with Content-Type application/pdf')
    }
    const sha256 = await this.storedPdfSha256(db, bucket, body)

    const { data: row, error } = await db
      .from('lease_documents')
      .insert({
        id: location.entityId,
        company_id: companyId,
        lease_id: leaseId,
        document_type: body.documentType,
        title: body.title,
        file_name: body.fileName,
        storage_path: body.storagePath,
        mime_type: body.mimeType,
        size_bytes: body.sizeBytes,
        sha256,
        // The database stamps auth.uid() over it (private.guard_lease_document), so it cannot be forged.
        uploaded_by_user_id: userId,
      })
      .select('*')
      .single()
    if (error?.code === '23505') throw new ConflictException('This file is already recorded; request a new upload URL')
    return toLeaseDocument(unwrapDatabase({ data: row, error }, 'Record lease document'))
  }

  /** A five-minute link to read one document's file; 404 when the document is not on this lease of the company. */
  async downloadUrl(db: DbClient, companyId: EntityId, leaseId: EntityId, documentId: EntityId): Promise<LeaseDocumentDownloadUrl> {
    const row = unwrapDatabase(
      await db
        .from('lease_documents')
        .select('storage_path')
        .eq('company_id', companyId)
        .eq('lease_id', leaseId)
        .eq('id', documentId)
        .maybeSingle(),
      'Get lease document',
    )
    const url = await this.storage.createSignedDownloadUrl(db, this.storage.leaseDocumentsBucket, row.storage_path, LEASE_DOCUMENT_DOWNLOAD_SECONDS)
    if (!url) throw new NotFoundException('The document file was not found')
    return { url, expiresInSeconds: LEASE_DOCUMENT_DOWNLOAD_SECONDS }
  }

  /** 404 when the lease is not in the company (RLS also hides other companies' leases). */
  private async assertLease(db: DbClient, companyId: EntityId, leaseId: EntityId): Promise<void> {
    unwrapDatabase(await db.from('leases').select('id').eq('company_id', companyId).eq('id', leaseId).maybeSingle(), 'Get lease')
  }

  /** SHA-256 (lowercase hex) of the stored object, refused with 422 when it is gone, differs in size or is not a PDF. */
  private async storedPdfSha256(db: DbClient, bucket: string, body: RegisterLeaseDocumentBody): Promise<string> {
    const file = await this.storage.download(db, bucket, body.storagePath)
    if (!file) throw new UnprocessableEntityException('Upload the file to storagePath before recording the document')
    if (file.size !== body.sizeBytes) throw new UnprocessableEntityException('The uploaded file size does not match sizeBytes')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
      throw new UnprocessableEntityException('The uploaded file is not a PDF')
    }
    return createHash('sha256').update(bytes).digest('hex')
  }
}

function assertSize(sizeBytes: number): void {
  if (sizeBytes > LEASE_DOCUMENT_MAX_BYTES) {
    throw new PayloadTooLargeException(`The file is larger than the ${LEASE_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB limit for lease documents`)
  }
}
