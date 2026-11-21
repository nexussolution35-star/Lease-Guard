import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common'
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger'
import type { PortfolioImportMapping, PortfolioImportPreview, PortfolioImportRowCheck } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../../common/decorators/current-company.decorator'
import { UserDb } from '../../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../../common/request-context'
import type { DbClient } from '../../../infrastructure/database/rls-client.factory'
import {
  ChangePortfolioImportRowDto,
  PortfolioImportMappingDto,
  PortfolioImportPreviewDto,
  PortfolioImportPreviewQueryDto,
  PortfolioImportRowCheckDto,
  SavePortfolioImportMappingDto,
} from './portfolio-import-preview.dto'
import {
  changePortfolioImportRowBodySchema,
  portfolioImportPreviewQuerySchema,
  savePortfolioImportMappingBodySchema,
} from './portfolio-import-preview.schemas'
import { PortfolioImportPreviewService } from './portfolio-import-preview.service'

// CompanyScoped is applied per route (not on the class) so the writer-only route runs the company guards once.
@ApiTags('portfolio-imports')
@Controller('portfolio-imports')
export class PortfolioImportPreviewController {
  constructor(private readonly preview: PortfolioImportPreviewService) {}

  @Get(':importId/mapping')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getPortfolioImportMapping',
    summary: "Get how a portfolio import's columns map to LeaseGuard fields",
    description:
      'The mapping applied to the batch; else the one the company last applied to a file with the same headings (source ' +
      'saved); else the one suggested from the headings, including the usual MRI, MDA, PropSys and Sage headings (source ' +
      'suggested). Suggestions look only at the headings, never at the values.',
  })
  @ApiOkResponse({ type: PortfolioImportMappingDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getMapping(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
  ): Promise<PortfolioImportMapping> {
    return this.preview.getMapping(db, company.companyId, importId)
  }

  @Put(':importId/mapping')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'savePortfolioImportMapping',
    summary: 'Apply a column mapping to a portfolio import (company admins and property managers)',
    description:
      'The mapping replaces the batch\'s and is saved for the next file with the same headings in this company. Nothing ' +
      'is written to properties or units. The database records the audit entry.',
  })
  @ApiOkResponse({ type: PortfolioImportMappingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'A column the file does not have, a column chosen twice, or a field not imported in this scope' })
  saveMapping(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Body(new ZodValidationPipe(savePortfolioImportMappingBodySchema)) body: SavePortfolioImportMappingDto,
  ): Promise<PortfolioImportMapping> {
    return this.preview.saveMapping(db, company.companyId, importId, body.mapping)
  }

  @Get(':importId/preview')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'previewPortfolioImport',
    summary: "Check a portfolio import's rows against the database",
    description:
      'Each row is read with the batch\'s mapping, validated with the property and unit rules, and matched: a property by ' +
      'its code, then by its name with its street address and postal code; a unit by its number within its property. ' +
      'Results: new, match (exists with the same values), conflict (exists with other values; both values given), invalid, ' +
      'duplicate (an earlier row names the same records). Counts cover the whole batch; the page holds the rows with ' +
      'the result asked for. Nothing is written.',
  })
  @ApiOkResponse({ type: PortfolioImportPreviewDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  previewRows(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Query(new ZodValidationPipe(portfolioImportPreviewQuerySchema)) query: PortfolioImportPreviewQueryDto,
  ): Promise<PortfolioImportPreview> {
    return this.preview.preview(db, company.companyId, importId, query)
  }

  @Patch(':importId/rows/:rowNumber')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'changePortfolioImportRow',
    summary: 'Correct, skip or link one row of a portfolio import (company admins and property managers)',
    description:
      'Corrections are merged by field (a value is read instead of the file\'s cell, an empty string clears it, null reads ' +
      'the file\'s cell again); skipped leaves the row out; link makes the row stand for an existing property and unit, so ' +
      'nothing new is created for them and the file\'s values for them are not used. Kept on the batch row: nothing is ' +
      'written to properties or units. A batch still read with a saved or suggested mapping has it applied first. The ' +
      'answer is the row checked again; other rows may change too (e.g. a duplicate of a skipped row). The database ' +
      'stamps who made the change and audits each previous and new value.',
  })
  @ApiOkResponse({ type: PortfolioImportRowCheckDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'Nothing to change, a field not imported in this scope, or a property or unit that cannot be linked to the row',
  })
  changeRow(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Param('rowNumber', new ParseIntPipe()) rowNumber: number,
    @Body(new ZodValidationPipe(changePortfolioImportRowBodySchema)) body: ChangePortfolioImportRowDto,
  ): Promise<PortfolioImportRowCheck> {
    return this.preview.changeRow(db, company.companyId, importId, rowNumber, body)
  }
}
