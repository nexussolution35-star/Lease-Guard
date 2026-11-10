import { STATEMENT_SOURCES, STATEMENT_STATUSES, type StatementStatus } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const STATEMENT_SORT_FIELDS = ['statementDate', 'uploadedAt'] as const

export const statementListQuerySchema = listQuerySchema(STATEMENT_SORT_FIELDS, {
  status: z.enum(STATEMENT_STATUSES).optional(),
  propertyId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  leaseId: z.uuid().optional(),
  sourceSystem: z.enum(STATEMENT_SOURCES).optional(),
})
export type StatementListQuery = z.infer<typeof statementListQuerySchema>

/** API sort field → database column. */
export const STATEMENT_SORT_COLUMNS = { statementDate: 'statement_date', uploadedAt: 'uploaded_at' } as const satisfies Record<
  (typeof STATEMENT_SORT_FIELDS)[number],
  string
>

/** Statement uploads are PDFs: the document-processing service reads nothing else. */
export const STATEMENT_UPLOAD_MIME_TYPES = ['application/pdf'] as const

/** Statements whose processing may be (re)started. Later states are under human review or final. */
export const PROCESSABLE_STATEMENT_STATUSES = ['uploaded', 'processing'] as const satisfies readonly StatementStatus[]

const fileName = z.string().trim().min(1).max(255)
const sizeBytes = z.number().int().positive()
const isoDate = z.iso.date()

export const createStatementUploadUrlBodySchema = z.strictObject({
  fileName,
  mimeType: z.enum(STATEMENT_UPLOAD_MIME_TYPES),
  sizeBytes,
})
export type CreateStatementUploadUrlBody = z.infer<typeof createStatementUploadUrlBodySchema>

/**
 * Registers an uploaded file as a statement. The statement date and period are NOT NULL in the
 * database and are never guessed, so the uploader must state them.
 */
export const registerStatementBodySchema = z
  .strictObject({
    propertyId: z.uuid(),
    storagePath: z.string().min(1).max(400),
    fileName,
    mimeType: z.enum(STATEMENT_UPLOAD_MIME_TYPES),
    sizeBytes,
    sha256: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 hex digest'),
    sourceSystem: z.enum(STATEMENT_SOURCES),
    statementDate: isoDate,
    periodStart: isoDate,
    periodEnd: isoDate,
    tenantId: z.uuid().optional(),
    unitId: z.uuid().optional(),
    leaseId: z.uuid().optional(),
    statementNumber: z.string().trim().min(1).max(100).optional(),
    uploadBatchId: z.string().trim().min(1).max(100).optional(),
  })
  .refine((body) => body.periodEnd >= body.periodStart, {
    path: ['periodEnd'],
    message: 'must be on or after periodStart',
  })
export type RegisterStatementBody = z.infer<typeof registerStatementBodySchema>
