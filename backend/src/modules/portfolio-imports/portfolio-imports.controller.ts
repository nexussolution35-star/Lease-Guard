import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiGatewayTimeoutResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { PortfolioImport } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  CreatePortfolioImportDto,
  CreatePortfolioImportFromGoogleSheetDto,
  CreatePortfolioImportUploadUrlDto,
  PortfolioImportDto,
  PortfolioImportListQueryDto,
  PortfolioImportPageDto,
  PortfolioImportUploadUrlDto,
  SelectPortfolioImportSheetDto,
} from './dto/portfolio-import.dto'
import {
  createPortfolioImportBodySchema,
  createPortfolioImportFromGoogleSheetBodySchema,
  createPortfolioImportUploadUrlBodySchema,
  portfolioImportListQuerySchema,
  selectPortfolioImportSheetBodySchema,
} from './portfolio-imports.schemas'
import { PortfolioImportsService, type PortfolioImportUploadUrl } from './portfolio-imports.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes run the company guards once.
@ApiTags('portfolio-imports')
@Controller('portfolio-imports')
export class PortfolioImportsController {
  constructor(private readonly imports: PortfolioImportsService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createPortfolioImportUploadUrl',
    summary: 'Get a signed URL to upload one portfolio file (CSV or XLSX)',
    description: 'Upload the file to signedUrl with the returned contentType, then call createPortfolioImport with the returned storagePath.',
  })
  @ApiOkResponse({ type: PortfolioImportUploadUrlDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than 5 MB' })
  createUploadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createPortfolioImportUploadUrlBodySchema)) body: CreatePortfolioImportUploadUrlDto,
  ): Promise<PortfolioImportUploadUrl> {
    return this.imports.createUploadUrl(db, company.companyId, body)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createPortfolioImport',
    summary: 'Read an uploaded portfolio file and record it as an import batch (company admins and property managers)',
    description:
      'The file is read on the server: CSV (comma or semicolon separated, UTF-8 with or without a byte-order mark) or XLSX ' +
      '(the first visible sheet unless sheetName names another). Empty rows are ignored; the first non-empty row holds the ' +
      'column headings. At most 5 MB, 5000 rows and 100 columns. Nothing is written to properties or units. The database ' +
      'records who uploaded the file and the audit entry.',
  })
  @ApiCreatedResponse({ type: PortfolioImportDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than 5 MB' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'Not uploaded, empty, headings only, over the row or column limit, unreadable, no such sheet, or a property that cannot take units',
  })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createPortfolioImportBodySchema)) body: CreatePortfolioImportDto,
  ): Promise<PortfolioImport> {
    return this.imports.create(db, company.companyId, body)
  }

  @Post('google-sheets')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createPortfolioImportFromGoogleSheet',
    summary: 'Read a Google Sheet from its link and record it as an import batch (company admins and property managers)',
    description:
      'Only Google Sheets links are accepted. The API reads the tab named in the link (or the first tab) as CSV, only from ' +
      'the docs.google.com export address it builds from the link\'s ids, following redirects to Google download hosts ' +
      'only, within a time and the 5 MB size limit. What it read is kept as the batch\'s file, so the batch does not ' +
      'change when the sheet does; it is then read as an uploaded CSV file is. The sheet must be shared with "Anyone with ' +
      'the link"; otherwise the answer says how to share it.',
  })
  @ApiCreatedResponse({ type: PortfolioImportDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Not a Google Sheets link' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The sheet is larger than 5 MB' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'Not shared with "Anyone with the link", no such sheet or tab, empty, headings only, over the row or column limit, or a property that cannot take units',
  })
  @ApiBadGatewayResponse({ type: ApiErrorDto, description: 'Google Sheets could not be reached' })
  @ApiGatewayTimeoutResponse({ type: ApiErrorDto, description: 'Google Sheets took too long to send the sheet' })
  createFromGoogleSheet(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createPortfolioImportFromGoogleSheetBodySchema)) body: CreatePortfolioImportFromGoogleSheetDto,
  ): Promise<PortfolioImport> {
    return this.imports.createFromGoogleSheet(db, company.companyId, body)
  }

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listPortfolioImports',
    summary: 'List the portfolio import batches of the active company, newest first',
    description: 'The import history: a batch left with rows to fix is resumed from here.',
  })
  @ApiOkResponse({ type: PortfolioImportPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(portfolioImportListQuerySchema)) query: PortfolioImportListQueryDto,
  ): Promise<Page<PortfolioImport>> {
    return this.imports.list(db, company.companyId, query)
  }

  @Get(':importId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getPortfolioImport', summary: 'Get one portfolio import batch' })
  @ApiOkResponse({ type: PortfolioImportDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
  ): Promise<PortfolioImport> {
    return this.imports.get(db, company.companyId, importId)
  }

  @Post(':importId/sheet')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'selectPortfolioImportSheet',
    summary: 'Read a portfolio workbook from another of its sheets (company admins and property managers)',
    description: 'The batch\'s columns, row count and rows are replaced by those of the chosen sheet. Choosing the current sheet changes nothing.',
  })
  @ApiOkResponse({ type: PortfolioImportDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'A CSV file, no such sheet, or the sheet cannot be accepted' })
  selectSheet(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Body(new ZodValidationPipe(selectPortfolioImportSheetBodySchema)) body: SelectPortfolioImportSheetDto,
  ): Promise<PortfolioImport> {
    return this.imports.selectSheet(db, company.companyId, importId, body.sheetName)
  }
}
