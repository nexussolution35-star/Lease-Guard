import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  PORTFOLIO_IMPORT_FIELD_KEYS,
  PORTFOLIO_IMPORT_MAPPING_SOURCES,
  PORTFOLIO_IMPORT_ROW_RESULTS,
  PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS,
  PORTFOLIO_IMPORT_TENANT_DECISIONS,
  PORTFOLIO_IMPORT_TENANT_MATCH_SOURCES,
  PORTFOLIO_IMPORT_TENANT_RESULTS,
  type PortfolioImportColumnMapping,
  type PortfolioImportConflict,
  type PortfolioImportCorrection,
  type PortfolioImportFieldKey,
  type PortfolioImportFieldMapping,
  type PortfolioImportMapping,
  type PortfolioImportMappingSource,
  type PortfolioImportMatchedRecord,
  type PortfolioImportPreview,
  type PortfolioImportResultCounts,
  type PortfolioImportRowChange,
  type PortfolioImportRowCheck,
  type PortfolioImportRowResolution,
  type PortfolioImportRowResult,
  type PortfolioImportTenantCheck,
  type PortfolioImportTenantContactDetail,
  type PortfolioImportTenantDecision,
  type PortfolioImportTenantMatchDecision,
  type PortfolioImportTenantMatchSource,
  type PortfolioImportTenantResult,
  type PortfolioImportTenantSuggestion,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type {
  changePortfolioImportRowBodySchema,
  portfolioImportPreviewQuerySchema,
  savePortfolioImportMappingBodySchema,
} from './portfolio-import-preview.schemas'

const FIELD = { enum: PORTFOLIO_IMPORT_FIELD_KEYS, enumName: 'PortfolioImportFieldKey' } as const

/** The file column read for each LeaseGuard field; a field left out is not read. */
export class PortfolioImportColumnMappingDto implements PortfolioImportColumnMapping {
  @ApiPropertyOptional() propertyCode?: string
  @ApiPropertyOptional() propertyName?: string
  @ApiPropertyOptional() propertyType?: string
  @ApiPropertyOptional() addressLine1?: string
  @ApiPropertyOptional() addressLine2?: string
  @ApiPropertyOptional() suburb?: string
  @ApiPropertyOptional() city?: string
  @ApiPropertyOptional() province?: string
  @ApiPropertyOptional() postalCode?: string
  @ApiPropertyOptional() grossLettableAreaSqm?: string
  @ApiPropertyOptional() unitNumber?: string
  @ApiPropertyOptional() unitType?: string
  @ApiPropertyOptional() floorAreaSqm?: string
  @ApiPropertyOptional() occupancyStatus?: string
  @ApiPropertyOptional() tenantTradingName?: string
  @ApiPropertyOptional() tenantLegalName?: string
  @ApiPropertyOptional() tenantRegistrationNumber?: string
  @ApiPropertyOptional() tenantAccountReference?: string
  @ApiPropertyOptional() tenantBusinessType?: string
  @ApiPropertyOptional() tenantContactPerson?: string
  @ApiPropertyOptional() tenantEmail?: string
  @ApiPropertyOptional() tenantPhone?: string
}

export class SavePortfolioImportMappingDto {
  @ApiProperty({ type: PortfolioImportColumnMappingDto, description: 'Every field to read, with its column; the columns must be the batch\'s, each used once' })
  mapping!: PortfolioImportColumnMappingDto
}

export class PortfolioImportFieldMappingDto implements PortfolioImportFieldMapping {
  @ApiProperty(FIELD) field!: PortfolioImportFieldKey
  @ApiPropertyOptional({ description: 'The file column read for the field; absent when it is not read' }) column?: string
  @ApiPropertyOptional({ description: 'The column suggested from the headings; absent when none fits' }) suggestedColumn?: string
}

export class PortfolioImportMappingDto implements PortfolioImportMapping {
  @ApiProperty({ format: 'uuid' }) importId!: string
  @ApiProperty({
    enum: PORTFOLIO_IMPORT_MAPPING_SOURCES,
    enumName: 'PortfolioImportMappingSource',
    description: 'applied: applied to this batch; saved: reused from the last file with the same headings; suggested: from the headings',
  })
  source!: PortfolioImportMappingSource
  @ApiProperty({ type: [PortfolioImportFieldMappingDto], description: 'Every field of the batch\'s scope, in template order' })
  fields!: PortfolioImportFieldMappingDto[]
  @ApiPropertyOptional({ format: 'date-time', description: 'When the reused mapping was saved (source saved)' }) savedAt?: string
}

export class PortfolioImportConflictDto implements PortfolioImportConflict {
  @ApiProperty(FIELD) field!: PortfolioImportFieldKey
  @ApiProperty({ description: "The row's value: an enum value, a number in plain notation, or text" }) value!: string
  @ApiProperty({ description: 'The existing record\'s value, or the earlier row\'s, in the same form' }) existingValue!: string
  @ApiPropertyOptional({ description: 'The earlier row the other value comes from; absent for the existing record' }) otherRowNumber?: number
}

export class PortfolioImportMatchedRecordDto implements PortfolioImportMatchedRecord {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ description: "The property's name, the unit's number, or the tenant's trading name" }) label!: string
}

export class PortfolioImportTenantSuggestionDto implements PortfolioImportTenantSuggestion {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() tradingName!: string
  @ApiProperty() legalName!: string
  @ApiPropertyOptional() registrationNumber?: string
  @ApiPropertyOptional() accountReference?: string
}

export class PortfolioImportTenantCheckDto implements PortfolioImportTenantCheck {
  @ApiProperty({
    enum: PORTFOLIO_IMPORT_TENANT_RESULTS,
    enumName: 'PortfolioImportTenantResult',
    description:
      'new: approving creates it; match: same registration number or account reference, or confirmed; suggested: similar names wait on the manager; conflict; invalid',
  })
  result!: PortfolioImportTenantResult
  @ApiProperty({ type: [String], description: 'Why the tenant has its result, in words for people' }) reasons!: string[]
  @ApiProperty({ description: 'The tenant\'s name as the row gives it' }) name!: string
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The tenant in LeaseGuard the row stands for (result match)' })
  tenant?: PortfolioImportMatchedRecordDto
  @ApiPropertyOptional({ enum: PORTFOLIO_IMPORT_TENANT_MATCH_SOURCES, enumName: 'PortfolioImportTenantMatchSource' })
  matchedBy?: PortfolioImportTenantMatchSource
  @ApiProperty({ type: [PortfolioImportTenantSuggestionDto], description: 'Tenants with a similar name, for the manager to confirm or reject' })
  suggestions!: PortfolioImportTenantSuggestionDto[]
  @ApiPropertyOptional({ description: 'The earlier row naming the same new tenant by its identifier; it is created once, from that row' })
  sameAsRowNumber?: number
  @ApiProperty({
    type: 'array',
    items: { type: 'string', enum: [...PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS] },
    description: 'Contact details the row leaves empty',
  })
  missingContactDetails!: PortfolioImportTenantContactDetail[]
}

export class PortfolioImportRowValuesDto extends PortfolioImportColumnMappingDto {}

export class PortfolioImportCorrectionDto implements PortfolioImportCorrection {
  @ApiProperty(FIELD) field!: PortfolioImportFieldKey
  @ApiProperty({ description: "The manager's value, read instead of the file's cell; empty when they cleared it" }) value!: string
  @ApiPropertyOptional({ description: "The file's cell under the batch's mapping; absent when empty or not mapped" }) fileValue?: string
}

export class PortfolioImportRowResolutionDto implements PortfolioImportRowResolution {
  @ApiProperty({ type: [PortfolioImportCorrectionDto] }) corrections!: PortfolioImportCorrectionDto[]
  @ApiProperty({ description: 'The row is left out of the import' }) skipped!: boolean
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The existing property the row stands for; nothing new is created for it' })
  linkedProperty?: PortfolioImportMatchedRecordDto
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The existing unit the row stands for; nothing new is created for it' })
  linkedUnit?: PortfolioImportMatchedRecordDto
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The existing tenant the manager confirmed the row\'s tenant is' })
  linkedTenant?: PortfolioImportMatchedRecordDto
  @ApiProperty({ description: 'The manager rejected the suggested tenants: the row\'s tenant is created as a new tenant' })
  tenantSuggestionsRejected!: boolean
  @ApiPropertyOptional({ format: 'uuid', description: 'Who made the last change; absent when they have left the company' }) changedByUserId?: string
  @ApiProperty({ format: 'date-time' }) changedAt!: string
}

/** Corrections by field: a value replaces the file's cell (empty clears it); null drops the correction. */
export class PortfolioImportRowCorrectionsDto {
  @ApiPropertyOptional({ type: String, nullable: true }) propertyCode?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) propertyName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) propertyType?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) addressLine1?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) addressLine2?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) suburb?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) city?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) province?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) postalCode?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) grossLettableAreaSqm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) unitNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) unitType?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) floorAreaSqm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) occupancyStatus?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantTradingName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantLegalName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantRegistrationNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantAccountReference?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantBusinessType?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantContactPerson?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantEmail?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) tenantPhone?: string | null
}

export class PortfolioImportRowLinkDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'An existing property of the workspace (properties imports only)' }) propertyId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'An existing unit: of propertyId when given, of the import\'s property for a units import' })
  unitId?: string
}

export class PortfolioImportTenantMatchDto implements PortfolioImportTenantMatchDecision {
  @ApiProperty({ enum: PORTFOLIO_IMPORT_TENANT_DECISIONS, enumName: 'PortfolioImportTenantDecision' }) decision!: PortfolioImportTenantDecision
  @ApiPropertyOptional({ format: 'uuid', description: 'The existing tenant the row\'s tenant is; required with confirmed' }) tenantId?: string
}

export class ChangePortfolioImportRowDto implements PortfolioImportRowChange {
  @ApiPropertyOptional({ type: PortfolioImportRowCorrectionsDto, description: 'Merged by field into the row\'s corrections' })
  corrections?: PortfolioImportRowCorrectionsDto
  @ApiPropertyOptional({ description: 'Leave the row out of the import (true) or include it again (false)' }) skipped?: boolean
  @ApiPropertyOptional({ type: PortfolioImportRowLinkDto, nullable: true, description: 'The existing records the row stands for; null removes the link' })
  link?: PortfolioImportRowLinkDto | null
  @ApiPropertyOptional({
    type: PortfolioImportTenantMatchDto,
    nullable: true,
    description: "The manager's decision on the row's suggested tenants: confirmed (with the tenant) or rejected; null withdraws it",
  })
  tenantMatch?: PortfolioImportTenantMatchDto | null
}

export class PortfolioImportRowCheckDto implements PortfolioImportRowCheck {
  @ApiProperty({ description: 'The row number in the file' }) rowNumber!: number
  @ApiProperty({ enum: PORTFOLIO_IMPORT_ROW_RESULTS, enumName: 'PortfolioImportRowResult' }) result!: PortfolioImportRowResult
  @ApiProperty({ type: [String], description: 'Why the row has its result, in words for people' }) reasons!: string[]
  @ApiProperty({ type: PortfolioImportRowValuesDto, description: 'The cells read for each mapped field, as written (empty cells left out)' })
  values!: PortfolioImportRowValuesDto
  @ApiProperty({ type: [PortfolioImportConflictDto] }) conflicts!: PortfolioImportConflictDto[]
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The existing property the row names' }) property?: PortfolioImportMatchedRecordDto
  @ApiPropertyOptional({ type: PortfolioImportMatchedRecordDto, description: 'The existing unit the row names' }) unit?: PortfolioImportMatchedRecordDto
  @ApiPropertyOptional({ description: 'The earlier row naming the same records (result duplicate)' }) duplicateOfRowNumber?: number
  @ApiPropertyOptional({ type: PortfolioImportTenantCheckDto, description: "The row's tenant, when the row has tenant values" })
  tenant?: PortfolioImportTenantCheckDto
  @ApiPropertyOptional({ type: PortfolioImportRowResolutionDto, description: 'What the manager changed on the row; absent while nobody has' })
  resolution?: PortfolioImportRowResolutionDto
}

export class PortfolioImportResultCountsDto implements PortfolioImportResultCounts {
  @ApiProperty() new!: number
  @ApiProperty() match!: number
  @ApiProperty() suggested!: number
  @ApiProperty() conflict!: number
  @ApiProperty() invalid!: number
  @ApiProperty() duplicate!: number
  @ApiProperty() skipped!: number
}

export class PortfolioImportPreviewDto implements PortfolioImportPreview {
  @ApiProperty({ format: 'uuid' }) importId!: string
  @ApiProperty({ type: PortfolioImportResultCountsDto, description: 'Rows of the whole batch per result' }) counts!: PortfolioImportResultCountsDto
  @ApiProperty({ type: [PortfolioImportRowCheckDto] }) items!: PortfolioImportRowCheckDto[]
  @ApiProperty({ minimum: 0, description: 'Rows matching the filter' }) total!: number
  @ApiProperty({ minimum: 1 }) page!: number
  @ApiProperty({ minimum: 1 }) pageSize!: number
}

export class PortfolioImportPreviewQueryDto {
  @ApiPropertyOptional({ enum: PORTFOLIO_IMPORT_ROW_RESULTS, enumName: 'PortfolioImportRowResult', description: 'Only rows with this result' })
  result?: PortfolioImportRowResult
  @ApiPropertyOptional({ minimum: 1, default: 1 }) page!: number
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE }) pageSize!: number
}

assertSchemaMatchesDto<z.infer<typeof savePortfolioImportMappingBodySchema>, SavePortfolioImportMappingDto>(true)
assertSchemaMatchesDto<z.infer<typeof portfolioImportPreviewQuerySchema>, PortfolioImportPreviewQueryDto>(true)
assertSchemaMatchesDto<z.infer<typeof changePortfolioImportRowBodySchema>, ChangePortfolioImportRowDto>(true)
