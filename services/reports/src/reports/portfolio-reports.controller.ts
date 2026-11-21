import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { PortfolioOverviewResponseDto, OccupancyResponseDto } from './dto/portfolio.dto'
import { ReportQueryDto } from './dto/report-common.dto'
import { PortfolioReportsService } from './portfolio-reports.service'
import { reportQuerySchema } from './report-query'

/**
 * The portfolio overview and occupancy reports (ticket R-01). Every report is `GET /api/v1/reports/{reportId}` with
 * the shared query (property, date range, status) and answers `{ reportId, asOf, filters, data }`. Read-only and open
 * to every member role of the active company; Row Level Security applies to every figure.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class PortfolioReportsController {
  constructor(private readonly reports: PortfolioReportsService) {}

  @Get('portfolio_overview')
  @ApiOperation({
    operationId: 'getPortfolioOverviewReport',
    summary: 'Portfolio overview: per property, units, occupancy, active leases, rental roll, outstanding and open events',
    description:
      'Counted as the dashboard counts: properties and units of properties that are not archived, occupied units by ' +
      'occupancy status, leases with status active, the outstanding balance on the latest verified statement of each ' +
      'account and open monitoring events. Filters: propertyId, status (property status). A monitoring report, never a transaction.',
  })
  @ApiOkResponse({ type: PortfolioOverviewResponseDto })
  portfolioOverview(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'portfolio_overview'>> {
    return this.reports.portfolioOverview(db, company.companyId, query)
  }

  @Get('occupancy')
  @ApiOperation({
    operationId: 'getOccupancyReport',
    summary: 'Occupancy by property and unit type, each unit with its current tenant',
    description:
      'Units of properties that are not archived (as the dashboard), by occupancy status, with floor areas. A unit\'s ' +
      'current tenant is its current lease\'s tenant, else the tenant assigned to it. Filters: propertyId, status (occupancy status).',
  })
  @ApiOkResponse({ type: OccupancyResponseDto })
  occupancy(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'occupancy'>> {
    return this.reports.occupancy(db, company.companyId, query)
  }
}
