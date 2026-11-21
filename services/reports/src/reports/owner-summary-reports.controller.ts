import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { ReportQueryDto } from './dto/report-common.dto'
import { OwnerWeeklySummaryResponseDto } from './dto/owner-summary.dto'
import { OwnerSummaryService } from './owner-summary.service'
import { reportQuerySchema } from './report-query'

/**
 * The weekly owner summary (ticket R-07) on the shared report endpoint pattern: a company admin previews this week's
 * summary of every property owner, the WhatsApp text and what became of this week's send. Sending is the reports
 * worker's job (it hands each summary to the core messaging pipeline); this endpoint only reads.
 */
@ApiTags('reports')
@CompanyScoped({ roles: ['company_admin'] })
@Controller('reports')
export class OwnerSummaryReportsController {
  constructor(private readonly summaries: OwnerSummaryService) {}

  @Get('owner_weekly_summary')
  @ApiOperation({
    operationId: 'getOwnerWeeklySummaryReport',
    summary: "Weekly owner summary: this week's WhatsApp portfolio summary of each property owner, and its send",
    description:
      "Company admins only. Per owner of the company's properties: the outstanding total from verified statements and its " +
      'change since the owner\'s previous stored summary, the important open monitoring events, the rental discrepancies ' +
      'outside tolerance, the guarantees expiring and the items needing the owner\'s attention, the WhatsApp text of the ' +
      'template chosen for owner_weekly_summary, why it would not be sent (no approved template, no connected number, no ' +
      'owner number), and this week\'s stored summary with its message\'s delivery status. Filter: propertyId (the owners ' +
      'of those properties).',
  })
  @ApiOkResponse({ type: OwnerWeeklySummaryResponseDto })
  ownerWeeklySummary(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'owner_weekly_summary'>> {
    return this.summaries.report(db, company.companyId, query)
  }
}
