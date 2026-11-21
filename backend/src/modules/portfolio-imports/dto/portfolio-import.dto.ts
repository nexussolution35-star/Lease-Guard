import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  PORTFOLIO_IMPORT_DELIMITERS,
  PORTFOLIO_IMPORT_FILE_FORMATS,
  PORTFOLIO_IMPORT_MIME_TYPES,
  PORTFOLIO_IMPORT_SCOPES,
  type GoogleSheetSource,
  type PortfolioImport,
  type PortfolioImportDelimiter,
  type PortfolioImportFileFormat,
  type PortfolioImportMimeType,
  type PortfolioImportScope,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type {
  portfolioImportListQuerySchema,
  createPortfolioImportBodySchema,
  createPortfolioImportFromGoogleSheetBodySchema,
  createPortfolioImportUploadUrlBodySchema,
  selectPortfolioImportSheetBodySchema,
} from '../portfolio-imports.schemas'
import type { PortfolioImportUploadUrl } from '../portfolio-imports.service'

/** The Google Sheet a batch was read from. */
export class GoogleSheetSourceDto implements GoogleSheetSource {
  @ApiProperty({ description: 'The spreadsheet id from the link' }) spreadsheetId!: string
  @ApiPropertyOptional({ description: "The tab (Google's gid); absent when the link named none and the first tab was read" }) gid?: string
}

/** An uploaded portfolio file accepted as an import batch. Same shape as the domain `PortfolioImport`. */
export class PortfolioImportDto implements PortfolioImport {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: PORTFOLIO_IMPORT_SCOPES, enumName: 'PortfolioImportScope', description: 'properties: properties with their units; units: units of propertyId' })
  scope!: PortfolioImportScope
  @ApiPropertyOptional({ format: 'uuid', description: 'Present exactly when scope is units' }) propertyId?: string
  @ApiProperty() fileName!: string
  @ApiProperty({ enum: PORTFOLIO_IMPORT_FILE_FORMATS, enumName: 'PortfolioImportFileFormat', description: 'Detected from the content' })
  fileFormat!: PortfolioImportFileFormat
  @ApiProperty() sizeBytes!: number
  @ApiPropertyOptional({ description: 'The worksheet the rows were read from (XLSX only)' }) sheetName?: string
  @ApiProperty({ type: [String], description: 'Every worksheet, in workbook order (empty for CSV)' }) sheetNames!: string[]
  @ApiPropertyOptional({ enum: PORTFOLIO_IMPORT_DELIMITERS, enumName: 'PortfolioImportDelimiter', description: 'The field separator detected (CSV only)' })
  delimiter?: PortfolioImportDelimiter
  @ApiPropertyOptional({
    type: GoogleSheetSourceDto,
    description: 'Present when the batch was read from a Google Sheets link; the CSV read is the batch file, so the batch does not change with the sheet',
  })
  googleSheet?: GoogleSheetSourceDto
  @ApiProperty({ type: [String], description: 'Column headings from the first non-empty row, in file order' }) columns!: string[]
  @ApiProperty({ description: 'Data rows stored; empty rows are ignored' }) rowCount!: number
  @ApiPropertyOptional({ format: 'uuid', description: 'Absent when the uploader has left the company' }) uploadedByUserId?: string
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export class CreatePortfolioImportUploadUrlDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'portfolio.xlsx', description: 'Must end in .csv or .xlsx' }) fileName!: string
  @ApiProperty({ minimum: 1, description: 'File size in bytes; at most 5 MB' }) sizeBytes!: number
}

const MIME_TYPES = Object.values(PORTFOLIO_IMPORT_MIME_TYPES)

export class PortfolioImportUploadUrlDto implements PortfolioImportUploadUrl {
  @ApiProperty({ format: 'uuid', description: 'Id the import will have once created' }) importId!: string
  @ApiProperty({ description: 'Pass unchanged to createPortfolioImport: <companyId>/<importId>/<file>' }) storagePath!: string
  @ApiProperty({ description: 'Upload the file here with PUT, or with supabase-js uploadToSignedUrl(storagePath, token, file)' }) signedUrl!: string
  @ApiProperty({ description: 'Upload token embedded in signedUrl' }) token!: string
  @ApiProperty({ enum: MIME_TYPES, enumName: 'PortfolioImportMimeType', description: 'Send the file with this Content-Type' })
  contentType!: PortfolioImportMimeType
  @ApiProperty({ description: 'Largest accepted file in bytes' }) maxSizeBytes!: number
}

export class CreatePortfolioImportDto {
  @ApiProperty({ enum: PORTFOLIO_IMPORT_SCOPES, enumName: 'PortfolioImportScope' }) scope!: PortfolioImportScope
  @ApiPropertyOptional({ format: 'uuid', description: 'Required to import units, and only then; the property must not be archived' })
  propertyId?: string
  @ApiProperty({ description: 'storagePath returned by createPortfolioImportUploadUrl, after the file was uploaded' }) storagePath!: string
  @ApiProperty({ minLength: 1, maxLength: 255 }) fileName!: string
  @ApiProperty({ minimum: 1 }) sizeBytes!: number
  @ApiPropertyOptional({ maxLength: 31, description: 'XLSX only: the sheet to read; the first visible sheet when omitted' }) sheetName?: string
}

export class CreatePortfolioImportFromGoogleSheetDto {
  @ApiProperty({ enum: PORTFOLIO_IMPORT_SCOPES, enumName: 'PortfolioImportScope' }) scope!: PortfolioImportScope
  @ApiPropertyOptional({ format: 'uuid', description: 'Required to import units, and only then; the property must not be archived' })
  propertyId?: string
  @ApiProperty({
    maxLength: 2000,
    example: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
    description: 'A Google Sheets link; the tab in it (gid) is read, or the first tab. The sheet must be shared with "Anyone with the link"',
  })
  url!: string
}

export class SelectPortfolioImportSheetDto {
  @ApiProperty({ minLength: 1, maxLength: 31 }) sheetName!: string
}

assertSchemaMatchesDto<z.infer<typeof createPortfolioImportUploadUrlBodySchema>, CreatePortfolioImportUploadUrlDto>(true)
assertSchemaMatchesDto<z.infer<typeof createPortfolioImportBodySchema>, CreatePortfolioImportDto>(true)
assertSchemaMatchesDto<z.infer<typeof createPortfolioImportFromGoogleSheetBodySchema>, CreatePortfolioImportFromGoogleSheetDto>(true)
assertSchemaMatchesDto<z.infer<typeof selectPortfolioImportSheetBodySchema>, SelectPortfolioImportSheetDto>(true)

export const PortfolioImportPageDto = createPageDto(PortfolioImportDto, 'PortfolioImportPage')

export class PortfolioImportListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) page!: number
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE }) pageSize!: number
  @ApiPropertyOptional({ enum: PORTFOLIO_IMPORT_SCOPES, enumName: 'PortfolioImportScope', description: 'Only imports adding this' })
  scope?: PortfolioImportScope
  @ApiPropertyOptional({ format: 'uuid', description: 'Only imports of units into this property' }) propertyId?: string
}

assertSchemaMatchesDto<z.infer<typeof portfolioImportListQuerySchema>, PortfolioImportListQueryDto>(true)
