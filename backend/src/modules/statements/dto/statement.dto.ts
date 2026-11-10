import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  EXTRACTION_FIELD_NAMES,
  EXTRACTION_ISSUE_CODES,
  EXTRACTION_ISSUE_SEVERITIES,
  EXTRACTION_STATUSES,
  LINE_ITEM_CATEGORIES,
  LINE_ITEM_KINDS,
  STATEMENT_SOURCES,
  STATEMENT_STATUSES,
  type DocumentExtractionIssue,
  type ExtractedField,
  type ExtractionIssueCode,
  type ExtractionIssueSeverity,
  type ExtractionFieldName,
  type ExtractionStatus,
  type LineItemCategory,
  type LineItemKind,
  type Statement,
  type StatementExtraction,
  type StatementLineItem,
  type StatementSource,
  type StatementStatus,
  type StoredFile,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { STATEMENT_SORT_FIELDS, type statementListQuerySchema } from '../statements.schemas'

const ZAR_DESCRIPTION = 'Rands (ZAR), 2 decimals'

export class StoredFileDto implements StoredFile {
  @ApiProperty() fileName!: string
  @ApiProperty({ description: 'Object path in the statements bucket: <companyId>/<statementId>/<file>' }) storagePath!: string
  @ApiProperty({ enum: ['application/pdf', 'image/png', 'image/jpeg'], enumName: 'StoredFileMimeType' })
  mimeType!: StoredFile['mimeType']
  @ApiProperty({ minimum: 1 }) sizeBytes!: number
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: 'SHA-256 hex digest of the file' }) sha256!: string
}

export class StatementLineItemDto implements StatementLineItem {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) statementId!: string
  @ApiProperty({ format: 'date' }) date!: string
  @ApiProperty() description!: string
  @ApiProperty({ enum: LINE_ITEM_CATEGORIES, enumName: 'LineItemCategory' }) category!: LineItemCategory
  @ApiProperty({ enum: LINE_ITEM_KINDS, enumName: 'LineItemKind' }) kind!: LineItemKind
  @ApiProperty({ description: `${ZAR_DESCRIPTION}; always positive, \`kind\` gives the direction`, minimum: 0 })
  amount!: number
  @ApiProperty({ description: 'Extraction confidence for this line was below threshold' }) flagged!: boolean
}

/** A tenant statement in the active company. Same shape as the domain `Statement`. */
export class StatementDto implements Statement {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string
  @ApiProperty({ type: StoredFileDto }) file!: StoredFileDto
  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' }) sourceSystem!: StatementSource
  @ApiPropertyOptional() statementNumber?: string
  @ApiProperty({ format: 'date' }) statementDate!: string
  @ApiProperty({ format: 'date' }) periodStart!: string
  @ApiProperty({ format: 'date' }) periodEnd!: string
  @ApiProperty({ enum: STATEMENT_STATUSES, enumName: 'StatementStatus' }) status!: StatementStatus
  @ApiPropertyOptional() uploadBatchId?: string
  @ApiProperty({ format: 'uuid' }) uploadedByUserId!: string
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string
  @ApiPropertyOptional({ format: 'uuid' }) extractionId?: string
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}. Present only once verified.` }) openingBalance?: number
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}. Present only once verified.` }) rentalCharged?: number
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}. Present only once verified.` }) additionalCharges?: number
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}. Present only once verified.` }) paymentsReceived?: number
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}; outstanding balance owed by the tenant. Present only once verified.` })
  closingBalance?: number
  @ApiPropertyOptional({ description: `${ZAR_DESCRIPTION}. Present only once verified.` }) totalDue?: number
  @ApiProperty({ type: [StatementLineItemDto] }) lineItems!: StatementLineItemDto[]
  @ApiPropertyOptional({ format: 'uuid' }) verifiedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) verifiedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) deliveredCommunicationId?: string
  @ApiPropertyOptional({ description: 'Why automatic processing could not complete; the statement needs manual review' })
  processingError?: string
  @ApiPropertyOptional({ format: 'uuid' }) duplicateOfStatementId?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const StatementPageDto = createPageDto(StatementDto, 'StatementPage')

export class StatementListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: STATEMENT_SORT_FIELDS, enumName: 'StatementSortField' })
  sort?: (typeof STATEMENT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: STATEMENT_STATUSES, enumName: 'StatementStatus' })
  status?: StatementStatus

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' })
  sourceSystem?: StatementSource
}

assertSchemaMatchesDto<z.infer<typeof statementListQuerySchema>, StatementListQueryDto>(true)

const FIELD_VALUE_SCHEMA = { oneOf: [{ type: 'string' }, { type: 'number' }] }

export class ExtractedFieldDto implements ExtractedField {
  @ApiProperty({ enum: EXTRACTION_FIELD_NAMES, enumName: 'ExtractionFieldName' }) name!: ExtractionFieldName
  @ApiProperty({ description: 'Document text the value was read from' }) rawText!: string
  @ApiProperty({ ...FIELD_VALUE_SCHEMA, nullable: true, description: 'Null when not found; never guessed' })
  value!: string | number | null
  @ApiProperty({ minimum: 0, maximum: 1 }) confidence!: number
  @ApiProperty({ description: 'A person must check this value' }) flagged!: boolean
  @ApiPropertyOptional({ ...FIELD_VALUE_SCHEMA, description: 'Value entered by the reviewer' })
  correctedValue?: string | number
  @ApiPropertyOptional({ format: 'uuid' }) correctedByUserId?: string
}

/** A validation issue reported by the document-processing service. */
export class ExtractionIssueDto implements DocumentExtractionIssue {
  @ApiProperty({ enum: EXTRACTION_ISSUE_CODES, enumName: 'ExtractionIssueCode' }) code!: ExtractionIssueCode
  @ApiProperty({ enum: EXTRACTION_ISSUE_SEVERITIES, enumName: 'ExtractionIssueSeverity' }) severity!: ExtractionIssueSeverity
  @ApiProperty() message!: string
  @ApiProperty({ enum: EXTRACTION_FIELD_NAMES, enumName: 'ExtractionFieldName', nullable: true })
  field!: ExtractionFieldName | null
}

/** The extractor's proposal for a statement. Never a verified statement by itself. */
export class StatementExtractionDto implements StatementExtraction {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) statementId!: string
  @ApiProperty() engine!: string
  @ApiProperty({ format: 'date-time' }) extractedAt!: string
  @ApiProperty({ minimum: 0, maximum: 1 }) overallConfidence!: number
  @ApiProperty({ type: [ExtractedFieldDto] }) fields!: ExtractedFieldDto[]
  @ApiPropertyOptional({ format: 'uuid' }) matchedTenantId?: string
  @ApiPropertyOptional({ format: 'uuid' }) matchedUnitId?: string
  @ApiProperty({ minimum: 0, maximum: 1 }) matchConfidence!: number
  @ApiProperty({ enum: EXTRACTION_STATUSES, enumName: 'ExtractionStatus' }) status!: ExtractionStatus
  @ApiPropertyOptional({ format: 'uuid' }) reviewedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) reviewedAt?: string
  @ApiPropertyOptional() reviewNotes?: string
  @ApiPropertyOptional({ type: [ExtractionIssueDto], description: 'Issues found by the extractor' })
  issues?: ExtractionIssueDto[]
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}
