import { LEASE_DOCUMENT_MIME_TYPES, LEASE_DOCUMENT_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

const fileName = z.string().trim().min(1).max(255)
const sizeBytes = z.number().int().positive()

/** `POST /leases/{leaseId}/documents/upload-url`: the file about to be uploaded. PDF only; the size is checked by the service. */
export const createLeaseDocumentUploadUrlBodySchema = z.strictObject({
  fileName,
  mimeType: z.enum(LEASE_DOCUMENT_MIME_TYPES),
  sizeBytes,
})
export type CreateLeaseDocumentUploadUrlBody = z.infer<typeof createLeaseDocumentUploadUrlBodySchema>

/** `POST /leases/{leaseId}/documents`: records a file uploaded to the storagePath the upload URL returned. */
export const registerLeaseDocumentBodySchema = z.strictObject({
  storagePath: z.string().min(1).max(400),
  fileName,
  mimeType: z.enum(LEASE_DOCUMENT_MIME_TYPES),
  sizeBytes,
  documentType: z.enum(LEASE_DOCUMENT_TYPES),
  title: z.string().trim().min(1).max(200),
})
export type RegisterLeaseDocumentBody = z.infer<typeof registerLeaseDocumentBodySchema>
