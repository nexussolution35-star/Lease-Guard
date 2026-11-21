import { ApiProperty } from '@nestjs/swagger'
import {
  LEASE_DOCUMENT_MAX_BYTES,
  LEASE_DOCUMENT_MIME_TYPES,
  LEASE_DOCUMENT_TYPES,
  type LeaseDocument,
  type LeaseDocumentMimeType,
  type LeaseDocumentType,
  type StoredFile,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { createLeaseDocumentUploadUrlBodySchema, registerLeaseDocumentBodySchema } from '../lease-documents.schemas'
import type { LeaseDocumentDownloadUrl, LeaseDocumentUploadUrl } from '../lease-documents.service'

/** The stored file of a lease document. Same shape as the domain `StoredFile`. */
export class LeaseDocumentFileDto implements StoredFile {
  @ApiProperty() fileName!: string
  @ApiProperty({ description: 'Object path in the lease-documents bucket: <companyId>/<documentId>/<file>' }) storagePath!: string
  @ApiProperty({ enum: ['application/pdf', 'image/png', 'image/jpeg'], enumName: 'StoredFileMimeType' })
  mimeType!: StoredFile['mimeType']
  @ApiProperty({ minimum: 1 }) sizeBytes!: number
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: 'SHA-256 hex digest of the file' }) sha256!: string
}

/** A document recorded on a lease. Same shape as the domain `LeaseDocument`. */
export class LeaseDocumentDto implements LeaseDocument {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) leaseId!: string
  @ApiProperty({ enum: LEASE_DOCUMENT_TYPES, enumName: 'LeaseDocumentType' }) documentType!: LeaseDocumentType
  @ApiProperty() title!: string
  @ApiProperty({ type: LeaseDocumentFileDto }) file!: LeaseDocumentFileDto
  @ApiProperty({ format: 'uuid', description: 'The member who uploaded it' }) uploadedByUserId!: string
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export class CreateLeaseDocumentUploadUrlDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'MSQ-L012 signed lease.pdf' })
  fileName!: string

  @ApiProperty({ enum: LEASE_DOCUMENT_MIME_TYPES, enumName: 'LeaseDocumentMimeType' })
  mimeType!: LeaseDocumentMimeType

  @ApiProperty({ minimum: 1, maximum: LEASE_DOCUMENT_MAX_BYTES, description: 'File size in bytes; at most 20 MB' })
  sizeBytes!: number
}

assertSchemaMatchesDto<z.infer<typeof createLeaseDocumentUploadUrlBodySchema>, CreateLeaseDocumentUploadUrlDto>(true)

export class LeaseDocumentUploadUrlDto implements LeaseDocumentUploadUrl {
  @ApiProperty({ format: 'uuid', description: 'Id the document will have once recorded' })
  documentId!: string

  @ApiProperty({ description: 'Pass unchanged to registerLeaseDocument: <companyId>/<documentId>/<file>' })
  storagePath!: string

  @ApiProperty({ description: 'Upload the file here with PUT (Content-Type application/pdf), or with supabase-js uploadToSignedUrl' })
  signedUrl!: string

  @ApiProperty({ description: 'Upload token embedded in signedUrl' })
  token!: string

  @ApiProperty({ description: 'Largest accepted file in bytes' })
  maxSizeBytes!: number
}

export class RegisterLeaseDocumentDto {
  @ApiProperty({ description: 'storagePath returned by createLeaseDocumentUploadUrl, after the file was uploaded' }) storagePath!: string
  @ApiProperty({ minLength: 1, maxLength: 255 }) fileName!: string
  @ApiProperty({ enum: LEASE_DOCUMENT_MIME_TYPES, enumName: 'LeaseDocumentMimeType' }) mimeType!: LeaseDocumentMimeType
  @ApiProperty({ minimum: 1, maximum: LEASE_DOCUMENT_MAX_BYTES }) sizeBytes!: number
  @ApiProperty({ enum: LEASE_DOCUMENT_TYPES, enumName: 'LeaseDocumentType' }) documentType!: LeaseDocumentType
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Signed lease' }) title!: string
}

assertSchemaMatchesDto<z.infer<typeof registerLeaseDocumentBodySchema>, RegisterLeaseDocumentDto>(true)

export class LeaseDocumentDownloadUrlDto implements LeaseDocumentDownloadUrl {
  @ApiProperty({ description: 'Short-lived signed link to the PDF' }) url!: string
  @ApiProperty({ example: 300 }) expiresInSeconds!: number
}
