import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { ReportQueryDto } from './dto/report-common.dto'
import { CommunicationActivityResponseDto, StatementProcessingResponseDto } from './dto/statement-communication.dto'
import { reportQuerySchema } from './report-query'
import { StatementCommunicationReportsService } from './statement-communication-reports.service'

/**
 * The statement processing and communication activity reports (ticket R-06), on the shared report endpoint pattern
 * `GET /api/v1/reports/{reportId}`. Read-only and open to every member role of the active company; Row Level
 * Security applies to every figure.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class StatementCommunicationReportsController {
  constructor(private readonly reports: StatementCommunicationReportsService) {}

  @Get('statement_processing')
  @ApiOperation({
    operationId: 'getStatementProcessingReport',
    summary: 'Statement processing: uploads by status, source system and property, the review backlog and processing failures',
    description:
      'Counted as the Statements page and the dashboard count them: a statement waits for review while its status is ' +
      'review_required (processing failures included), its processing failed when it waits with a processing error, and a ' +
      'field is unresolved until confirmed or corrected. Filters: propertyId, from/to (upload date, South African), ' +
      'status (statement status).',
  })
  @ApiOkResponse({ type: StatementProcessingResponseDto })
  statementProcessing(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'statement_processing'>> {
    return this.reports.statementProcessing(db, company.companyId, query)
  }

  @Get('communication_activity')
  @ApiOperation({
    operationId: 'getCommunicationActivityReport',
    summary: 'Communication activity: messages by type, status, delivery outcome and property, and the approvals pending with their age',
    description:
      'Counted as communication analytics and the dashboard count them: an outbound message is handed over once queued, ' +
      'sent, delivered, read or failed, delivered includes read, and a message waits for approval while its approval request ' +
      'is pending. Filters: propertyId (leaves out messages without a property), from/to (message date, South African), ' +
      'status (delivery status). A monitoring report: nothing is sent or approved from it.',
  })
  @ApiOkResponse({ type: CommunicationActivityResponseDto })
  communicationActivity(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'communication_activity'>> {
    return this.reports.communicationActivity(db, company.companyId, query)
  }
}
