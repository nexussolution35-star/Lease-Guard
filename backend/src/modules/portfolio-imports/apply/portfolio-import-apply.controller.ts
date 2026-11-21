import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { PortfolioImportSummary } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { UserDb } from '../../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../../common/request-context'
import type { DbClient } from '../../../infrastructure/database/rls-client.factory'
import { ApprovePortfolioImportDto, PortfolioImportSummaryDto } from './portfolio-import-apply.dto'
import { approvePortfolioImportBodySchema } from './portfolio-import-apply.schemas'
import { PortfolioImportApplyService } from './portfolio-import-apply.service'

// CompanyScoped is applied per route (not on the class) so the writer-only route runs the company guards once.
@ApiTags('portfolio-imports')
@Controller('portfolio-imports')
export class PortfolioImportApplyController {
  constructor(private readonly apply: PortfolioImportApplyService) {}

  @Get(':importId/summary')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getPortfolioImportSummary',
    summary: 'Get what approving a portfolio import creates',
    description:
      'From the rows checked against the live records, as the preview checks them: the properties and units approving ' +
      'creates now, the rows linked to records that exist (match), the rows skipped and the rows still blocked ' +
      '(invalid, conflict, duplicate; left out until fixed); with the last approval and every record the import created.',
  })
  @ApiOkResponse({ type: PortfolioImportSummaryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getSummary(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
  ): Promise<PortfolioImportSummary> {
    return this.apply.summary(db, company.companyId, importId)
  }

  @Post(':importId/approve')
  @HttpCode(200)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'approvePortfolioImport',
    summary: 'Approve a portfolio import and create its new properties and units (company admins and property managers)',
    description:
      'Creates the properties and units of the rows that are new, with the same validation and write path as the ' +
      'property and unit forms, in one transaction: all of them land or none do. Rows still blocked stay out until they ' +
      'are fixed; the import can be approved again later for them. The approver is the new properties\' manager. When ' +
      'nothing is left to create, the summary is returned unchanged, so approving twice or importing the same file ' +
      'again never creates duplicates. Each created record is audited as created by import with the batch reference. ' +
      'Importing never enables or sends tenant messaging.',
  })
  @ApiOkResponse({ type: PortfolioImportSummaryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Records were added meanwhile: check the rows again' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'The accounting system is missing while properties are created, or a record breaks a property or unit rule (e.g. an archived property)',
  })
  approve(
    @UserDb() db: DbClient,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Body(new ZodValidationPipe(approvePortfolioImportBodySchema)) body: ApprovePortfolioImportDto,
  ): Promise<PortfolioImportSummary> {
    return this.apply.approve(db, company.companyId, importId, { userId: user.userId, accountingSystem: body.accountingSystem })
  }
}
