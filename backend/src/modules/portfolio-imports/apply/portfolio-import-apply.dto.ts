import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  PORTFOLIO_IMPORT_RECORD_TYPES,
  PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS,
  STATEMENT_SOURCES,
  type ApprovePortfolioImportInput,
  type PortfolioImportApproval,
  type PortfolioImportCreatedRecord,
  type PortfolioImportMissingContactDetails,
  type PortfolioImportTenantContactDetail,
  type PortfolioImportRecordType,
  type PortfolioImportSummary,
  type StatementSource,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { approvePortfolioImportBodySchema } from './portfolio-import-apply.schemas'

export class ApprovePortfolioImportDto implements ApprovePortfolioImportInput {
  @ApiPropertyOptional({
    enum: STATEMENT_SOURCES,
    enumName: 'StatementSource',
    description: "The accounting system the new properties' statements come from; required when the import creates properties",
  })
  accountingSystem?: StatementSource
}

export class PortfolioImportCreatedRecordDto implements PortfolioImportCreatedRecord {
  @ApiProperty({ enum: PORTFOLIO_IMPORT_RECORD_TYPES, enumName: 'PortfolioImportRecordType' }) recordType!: PortfolioImportRecordType
  @ApiProperty({ format: 'uuid', description: "The property's id, the unit's, or the tenant's" }) id!: string
  @ApiProperty({ description: "The property's name and code, the unit's number, or the tenant's trading name" }) label!: string
  @ApiProperty({ format: 'uuid', description: 'The property created, or the property of the unit created (or of the tenant\'s unit)' })
  propertyId!: string
  @ApiProperty() propertyName!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'The unit a created tenant is the tenant of (record type tenant)' }) unitId?: string
  @ApiPropertyOptional({ description: 'The number of that unit' }) unitNumber?: string
  @ApiProperty({ description: 'The batch row the record was created from' }) rowNumber!: number
  @ApiProperty({ format: 'date-time' }) createdAt!: string
}

export class PortfolioImportMissingContactDetailsDto implements PortfolioImportMissingContactDetails {
  @ApiProperty() rowNumber!: number
  @ApiProperty({ description: "The tenant's name as the row gives it" }) tenantName!: string
  @ApiProperty({ type: 'array', items: { type: 'string', enum: [...PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS] } })
  missing!: PortfolioImportTenantContactDetail[]
  @ApiProperty({ description: 'A new tenant cannot be created without its contact person and phone: the row stays blocked' })
  blocksCreation!: boolean
}

export class PortfolioImportApprovalDto implements PortfolioImportApproval {
  @ApiPropertyOptional({ format: 'uuid', description: 'Who approved; absent when they have left the company' }) approvedByUserId?: string
  @ApiProperty({ format: 'date-time' }) approvedAt!: string
}

export class PortfolioImportSummaryDto implements PortfolioImportSummary {
  @ApiProperty({ format: 'uuid' }) importId!: string
  @ApiProperty({ minimum: 0 }) propertiesToCreate!: number
  @ApiProperty({ minimum: 0 }) unitsToCreate!: number
  @ApiProperty({ minimum: 0, description: 'New tenants approving creates (a tenant several rows name counts once)' }) tenantsToCreate!: number
  @ApiProperty({ minimum: 0, description: 'Rows whose tenant is a tenant in LeaseGuard (identifier in common, or confirmed)' })
  tenantsLinked!: number
  @ApiProperty({ minimum: 0, description: "Rows whose tenant's suggested match waits on the manager (among the blocked rows)" })
  tenantSuggestionsToReview!: number
  @ApiProperty({ type: [PortfolioImportMissingContactDetailsDto], description: 'Rows with a new tenant that leave contact details empty' })
  missingContactDetails!: PortfolioImportMissingContactDetailsDto[]
  @ApiProperty({ minimum: 0, description: 'Rows whose records all exist (result match): nothing is created for them' }) linkedRows!: number
  @ApiProperty({ minimum: 0 }) skippedRows!: number
  @ApiProperty({ minimum: 0, description: 'Rows left out until they are fixed (invalid, conflict, duplicate, suggested)' }) blockedRows!: number
  @ApiProperty({ description: 'Whether approving now would create anything' }) canApprove!: boolean
  @ApiProperty({ description: 'Whether approving needs accountingSystem (the import creates properties)' }) needsAccountingSystem!: boolean
  @ApiPropertyOptional({ type: PortfolioImportApprovalDto, description: 'The last approval; absent until the import is approved' })
  approval?: PortfolioImportApprovalDto
  @ApiProperty({ type: [PortfolioImportCreatedRecordDto], description: 'Every record the import created, in row order' })
  created!: PortfolioImportCreatedRecordDto[]
}

assertSchemaMatchesDto<z.infer<typeof approvePortfolioImportBodySchema>, ApprovePortfolioImportDto>(true)
