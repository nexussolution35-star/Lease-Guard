import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { LeaseExpiryResponseDto, RenewalDeadlinesResponseDto } from './dto/lease-dates.dto'
import { ReportQueryDto } from './dto/report-common.dto'
import { LeaseDateReportsService } from './lease-date-reports.service'
import { reportQuerySchema } from './report-query'

/**
 * The lease expiry and renewal deadline reports (ticket R-03), on the shared report endpoint pattern
 * `GET /api/v1/reports/{reportId}`. Read-only and open to every member role of the active company; Row Level Security
 * applies to every figure. Only verified leases in a monitored status are reported, as monitoring does.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class LeaseDateReportsController {
  constructor(private readonly reports: LeaseDateReportsService) {}

  @Get('lease_expiry')
  @ApiOperation({
    operationId: 'getLeaseExpiryReport',
    summary: 'Lease expiry: verified leases by expiry bucket (expired, 0–3, 3–6, 6–12 months, later), soonest first',
    description:
      'Verified leases in a monitored status (active, expiring), each with its expiry date, days to expiry, bucket in ' +
      'calendar months from the as-at date, rental, renewal option, the company notice threshold reached (the one ' +
      'monitoring raises its expiry event for) and its open expiry event. Filters: propertyId, from/to (expiry date), ' +
      'status (expiry bucket). A monitoring report, never a transaction.',
  })
  @ApiOkResponse({ type: LeaseExpiryResponseDto })
  leaseExpiry(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'lease_expiry'>> {
    return this.reports.leaseExpiry(db, company.companyId, query)
  }

  @Get('renewal_deadlines')
  @ApiOperation({
    operationId: 'getRenewalDeadlinesReport',
    summary: 'Renewal deadlines: renewal-notice deadlines of verified renewal options, soonest first, with days left',
    description:
      'Verified leases in a monitored status with a renewal option and a notice period: the deadline (expiry less the ' +
      'notice period), days left, its status (passed, due within 14, 30 or 90 days, open, exercised), the company ' +
      'warning threshold reached (the one monitoring raises its renewal event for) and its open renewal event. Filters: ' +
      'propertyId, from/to (notice deadline), status (deadline status). A monitoring report, never a transaction.',
  })
  @ApiOkResponse({ type: RenewalDeadlinesResponseDto })
  renewalDeadlines(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'renewal_deadlines'>> {
    return this.reports.renewalDeadlines(db, company.companyId, query)
  }
}
