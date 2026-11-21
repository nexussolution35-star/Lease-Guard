import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import { EXTRACTION_FIELD_NAMES, type ExtractionFieldName, type Statement, type StatementExtraction } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { StatementDto, StatementExtractionDto } from './dto/statement.dto'
import { CorrectExtractedFieldDto, SetStatementMatchDto, StatementDownloadUrlDto } from './dto/statement-review.dto'
import { correctExtractedFieldBodySchema, extractionFieldNameSchema, setStatementMatchBodySchema } from './statement-review.schemas'
import { STATEMENT_DOWNLOAD_SECONDS, StatementReviewService, type StatementDownloadUrl } from './statement-review.service'

const FIELD_PARAM = { name: 'fieldName', enum: EXTRACTION_FIELD_NAMES, enumName: 'ExtractionFieldName' } as const
const REVIEW_CLOSED = 'The statement is not under review (uploaded, processing, verified, rejected or duplicate) or its extraction was already reviewed'

/** Reviewing a processed statement: its original file, its extracted fields and its tenant, unit and lease. */
@ApiTags('statements')
@Controller('statements')
export class StatementReviewController {
  constructor(private readonly review: StatementReviewService) {}

  @Get(':statementId/download-url')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getStatementDownloadUrl',
    summary: `A ${STATEMENT_DOWNLOAD_SECONDS / 60}-minute link to a statement's original file`,
  })
  @ApiOkResponse({ type: StatementDownloadUrlDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The statement is not in the active company, or its file is gone' })
  downloadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
  ): Promise<StatementDownloadUrl> {
    return this.review.downloadUrl(db, company.companyId, statementId)
  }

  @Put(':statementId/extraction/fields/:fieldName/correction')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'correctStatementField',
    summary: 'Enter the correct value of one extracted field',
    description:
      'The value is recorded as the correction beside the extracted value (which is kept), with who and when; any ' +
      'confirmation of the field is replaced. Audited with before and after. Returns the extraction.',
  })
  @ApiParam(FIELD_PARAM)
  @ApiOkResponse({ type: StatementExtractionDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Statement not found or not yet extracted' })
  @ApiConflictResponse({ type: ApiErrorDto, description: REVIEW_CLOSED })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'Not a valid value for this field' })
  correct(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
    @Param('fieldName', new ZodValidationPipe(extractionFieldNameSchema)) fieldName: ExtractionFieldName,
    @Body(new ZodValidationPipe(correctExtractedFieldBodySchema)) body: CorrectExtractedFieldDto,
  ): Promise<StatementExtraction> {
    return this.review.correctField(db, company.companyId, statementId, fieldName, body.value)
  }

  @Post(':statementId/extraction/fields/:fieldName/confirm')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'confirmStatementField',
    summary: 'Confirm that an extracted value is correct',
    description:
      'Resolves a flagged field with the extracted value, recording who and when, and drops any correction. A ' +
      'value the extractor did not find cannot be confirmed (422): enter it with correctStatementField. Confirming ' +
      'a confirmed field changes nothing. Audited with before and after. Returns the extraction.',
  })
  @ApiParam(FIELD_PARAM)
  @ApiOkResponse({ type: StatementExtractionDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Statement not found or not yet extracted' })
  @ApiConflictResponse({ type: ApiErrorDto, description: REVIEW_CLOSED })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The value was not found on the statement' })
  confirm(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
    @Param('fieldName', new ZodValidationPipe(extractionFieldNameSchema)) fieldName: ExtractionFieldName,
  ): Promise<StatementExtraction> {
    return this.review.confirmField(db, company.companyId, statementId, fieldName)
  }

  @Put(':statementId/match')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'setStatementMatch',
    summary: "Set the statement's tenant, unit and lease together",
    description:
      "The extraction's proposed match (matchedTenantId, matchedUnitId) is only a suggestion; this call sets the " +
      "match. The unit must be on the statement's property. Without leaseId the tenant's lease of the unit in force " +
      'on the statement date (the reviewed statement_date field, else the date typed at upload) is used; with it, ' +
      'that lease must be the tenant\'s lease of the unit and in force on that date. Audited. Returns the statement.',
  })
  @ApiOkResponse({ type: StatementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The statement is not under review' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description:
      'The tenant, unit and lease do not belong together or to the statement\'s property, or no single lease was in force on the statement date (every reason listed)',
  })
  setMatch(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
    @Body(new ZodValidationPipe(setStatementMatchBodySchema)) body: SetStatementMatchDto,
  ): Promise<Statement> {
    return this.review.setMatch(db, company.companyId, statementId, body)
  }
}
