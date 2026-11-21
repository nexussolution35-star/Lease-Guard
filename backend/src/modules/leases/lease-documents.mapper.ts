import type { LeaseDocument, StoredFile } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type LeaseDocumentRow = Tables<'lease_documents'>

const MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const satisfies readonly StoredFile['mimeType'][]

function toMimeType(value: string): StoredFile['mimeType'] {
  const match = MIME_TYPES.find((type) => type === value)
  if (!match) throw new Error(`Unexpected lease document mime_type "${value}"`)
  return match
}

/** `lease_documents` row → domain `LeaseDocument`. */
export function toLeaseDocument(row: LeaseDocumentRow): LeaseDocument {
  return {
    id: row.id,
    companyId: row.company_id,
    leaseId: row.lease_id,
    documentType: row.document_type,
    title: row.title,
    file: {
      fileName: row.file_name,
      storagePath: row.storage_path,
      mimeType: toMimeType(row.mime_type),
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
    },
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
