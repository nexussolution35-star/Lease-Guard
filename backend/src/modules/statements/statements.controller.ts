import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseFilters } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Statement, StatementExtraction } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { StatementDto, StatementExtractionDto, StatementListQueryDto, StatementPageDto } from './dto/statement.dto'
import {
  CreateStatementUploadUrlDto,
  DuplicateStatementErrorDto,
  ProcessStatementResultDto,
  RegisterStatementDto,
  RegisterStatementResultDto,
  StatementUploadUrlDto,
} from './dto/statement-upload.dto'
import { DuplicateStatementFilter } from './duplicate-statement.exception'
import type { ProcessStatementResult, RegisterStatementResult, StatementUploadUrl } from './statement-uploads.types'
import { StatementUploadsService } from './statement-uploads.service'
import {
  createStatementUploadUrlBodySchema,
  registerStatementBodySchema,
  statementListQuerySchema,
} from './statements.schemas'
import { StatementsService } from './statements.service'

// CompanyScoped is applied per route (not on the class) so write routes run the company guards once.
@ApiTags('statements')
@Controller('statements')
export class StatementsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly uploads: StatementUploadsService,
  ) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listStatements', summary: 'List tenant statements in the active company' })
  @ApiOkResponse({ type: StatementPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(statementListQuerySchema)) query: StatementListQueryDto,
  ): Promise<Page<Statement>> {
    return this.statements.list(db, company.companyId, query)
  }

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createStatementUploadUrl',
    summary: 'Get a signed URL to upload one statement PDF',
    description: 'Upload the file to signedUrl, then call registerStatement with the returned storagePath.',
  })
  @ApiOkResponse({ type: StatementUploadUrlDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than DOCUMENT_PROCESSING_MAX_FILE_MB' })
  createUploadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createStatementUploadUrlBodySchema)) body: CreateStatementUploadUrlDto,
  ): Promise<StatementUploadUrl> {
    return this.uploads.createUploadUrl(db, company.companyId, body)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @UseFilters(DuplicateStatementFilter)
  @ApiOperation({
    operationId: 'registerStatement',
    summary: 'Register an uploaded statement file and queue it for extraction',
    description:
      'An identical file (SHA-256) already on record is refused with 409 and the existing statement. A likely ' +
      'duplicate (same tenant, period and number) is registered and returned as a warning for the reviewer. The ' +
      'SHA-256 is computed from the stored file and must equal sha256 (422 otherwise). Without tenantId or unitId, ' +
      'a statement filed against a lease takes the lease\'s tenant and unit.',
  })
  @ApiCreatedResponse({ type: RegisterStatementResultDto })
  @ApiConflictResponse({ type: DuplicateStatementErrorDto, description: 'Identical file already registered' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than DOCUMENT_PROCESSING_MAX_FILE_MB' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'File not uploaded, size or SHA-256 mismatch, or unknown property/tenant/unit/lease' })
  register(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerStatementBodySchema)) body: RegisterStatementDto,
  ): Promise<RegisterStatementResult> {
    return this.uploads.register(db, company.companyId, user.userId, body)
  }

  @Get(':statementId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getStatement', summary: 'Get one statement with its line items' })
  @ApiOkResponse({ type: StatementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
  ): Promise<Statement> {
    return this.statements.get(db, company.companyId, statementId)
  }

  @Get(':statementId/extraction')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getStatementExtraction',
    summary: 'Get the latest extraction proposal for a statement',
    description: 'Extracted values are proposals for review; flagged or missing values are never guessed.',
  })
  @ApiOkResponse({ type: StatementExtractionDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Statement not found or not yet extracted' })
  getExtraction(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
  ): Promise<StatementExtraction> {
    return this.statements.getExtraction(db, company.companyId, statementId)
  }

  @Post(':statementId/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'processStatement',
    summary: 'Queue extraction for an uploaded statement again',
    description:
      'Idempotent: repeated calls return the same job id. A job still waiting or running is left alone; a job ' +
      'that failed, or completed without moving the statement on, is run again. `outcome` says which.',
  })
  @ApiAcceptedResponse({ type: ProcessStatementResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The statement is already under review or final' })
  process(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
  ): Promise<ProcessStatementResult> {
    return this.uploads.process(db, company.companyId, statementId)
  }
}
