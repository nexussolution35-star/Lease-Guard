import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { STATEMENT_SOURCES, type DuplicateMatch, type DuplicateReason, type StatementSource, type StatementStatus } from '@leaseguard/domain'
import type { z } from 'zod'

import { ApiErrorDto } from '../../../common/http/api-error.dto'
import { ENQUEUE_OUTCOMES, type EnqueueOutcome } from '../../../infrastructure/queues/queue-producer'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  PROCESSABLE_STATEMENT_STATUSES,
  STATEMENT_UPLOAD_MIME_TYPES,
  type createStatementUploadUrlBodySchema,
  type registerStatementBodySchema,
} from '../statements.schemas'
import type {
  DuplicateStatementErrorBody,
  ProcessStatementResult,
  RegisterStatementResult,
  StatementUploadUrl,
} from '../statement-uploads.types'
import { StatementDto } from './statement.dto'

export class CreateStatementUploadUrlDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'MSQ-Shop12-2026-10.pdf' })
  fileName!: string

  @ApiProperty({ enum: STATEMENT_UPLOAD_MIME_TYPES, enumName: 'StatementUploadMimeType' })
  mimeType!: (typeof STATEMENT_UPLOAD_MIME_TYPES)[number]

  @ApiProperty({ minimum: 1, description: 'File size in bytes; at most DOCUMENT_PROCESSING_MAX_FILE_MB' })
  sizeBytes!: number
}

assertSchemaMatchesDto<z.infer<typeof createStatementUploadUrlBodySchema>, CreateStatementUploadUrlDto>(true)

export class StatementUploadUrlDto implements StatementUploadUrl {
  @ApiProperty({ format: 'uuid', description: 'Id the statement will have once registered' })
  statementId!: string

  @ApiProperty({ example: 'statements' })
  bucket!: string

  @ApiProperty({ description: 'Pass unchanged to registerStatement: <companyId>/<statementId>/<file>' })
  storagePath!: string

  @ApiProperty({ description: 'Upload the file here with PUT, or with supabase-js uploadToSignedUrl(storagePath, token, file)' })
  signedUrl!: string

  @ApiProperty({ description: 'Upload token embedded in signedUrl' })
  token!: string

  @ApiProperty({ description: 'Largest accepted file in bytes' })
  maxSizeBytes!: number
}

export class RegisterStatementDto {
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty({ description: 'storagePath returned by createStatementUploadUrl, after the file was uploaded' }) storagePath!: string
  @ApiProperty({ minLength: 1, maxLength: 255 }) fileName!: string
  @ApiProperty({ enum: STATEMENT_UPLOAD_MIME_TYPES, enumName: 'StatementUploadMimeType' })
  mimeType!: (typeof STATEMENT_UPLOAD_MIME_TYPES)[number]
  @ApiProperty({ minimum: 1 }) sizeBytes!: number
  @ApiProperty({ pattern: '^[0-9a-fA-F]{64}$', description: 'SHA-256 hex digest of the uploaded file' }) sha256!: string
  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' }) sourceSystem!: StatementSource
  @ApiProperty({ format: 'date' }) statementDate!: string
  @ApiProperty({ format: 'date' }) periodStart!: string
  @ApiProperty({ format: 'date', description: 'On or after periodStart' }) periodEnd!: string
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string
  @ApiPropertyOptional({ maxLength: 100 }) statementNumber?: string
  @ApiPropertyOptional({ maxLength: 100 }) uploadBatchId?: string
}

assertSchemaMatchesDto<z.infer<typeof registerStatementBodySchema>, RegisterStatementDto>(true)

const DUPLICATE_REASONS = ['identical_file', 'same_tenant_period_and_number'] as const satisfies readonly DuplicateReason[]
// Compile-time check that every domain DuplicateReason is documented.
const _allDuplicateReasons: Exclude<DuplicateReason, (typeof DUPLICATE_REASONS)[number]> extends never ? true : never = true
void _allDuplicateReasons

export class DuplicateMatchDto implements DuplicateMatch {
  @ApiProperty({ format: 'uuid' }) existingStatementId!: string
  @ApiProperty({ enum: DUPLICATE_REASONS, enumName: 'DuplicateReason' }) reason!: DuplicateReason
  @ApiProperty({ enum: ['exact', 'likely'], enumName: 'DuplicateConfidence' }) confidence!: 'exact' | 'likely'
  @ApiProperty() description!: string
}

export class RegisterStatementResultDto implements RegisterStatementResult {
  @ApiProperty({ type: StatementDto }) statement!: StatementDto

  @ApiProperty({
    type: DuplicateMatchDto,
    nullable: true,
    description: 'A likely duplicate (same tenant, period and number) for the reviewer to check; null when none',
  })
  duplicate!: DuplicateMatchDto | null

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Processing job id; null when the queue was unavailable (call processStatement to retry)',
  })
  processingJobId!: string | null
}

export class DuplicateStatementErrorDto extends ApiErrorDto implements DuplicateStatementErrorBody {
  @ApiProperty({ type: DuplicateMatchDto, description: 'The statement already registered with this file' })
  duplicate!: DuplicateMatchDto
}

export class ProcessStatementResultDto implements ProcessStatementResult {
  @ApiProperty({ format: 'uuid' }) statementId!: string
  @ApiProperty({ enum: PROCESSABLE_STATEMENT_STATUSES, enumName: 'ProcessableStatementStatus' })
  status!: Extract<StatementStatus, (typeof PROCESSABLE_STATEMENT_STATUSES)[number]>
  @ApiProperty({ description: 'Deterministic job id; repeated calls return the same id' }) jobId!: string
  @ApiProperty({
    enum: ENQUEUE_OUTCOMES,
    enumName: 'EnqueueOutcome',
    description:
      'added: a new job was queued; already_queued: the job is still waiting or running and was left alone; ' +
      'retried: a permanently failed job was run again; requeued: a completed job that did not move the statement on was queued again',
  })
  outcome!: EnqueueOutcome
}
