import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { LeaseMonitoringResponseDto, RentalDiscrepanciesResponseDto } from './dto/monitoring.dto'
import { ReportQueryDto } from './dto/report-common.dto'
import { MonitoringReportsService } from './monitoring-reports.service'
import { reportQuerySchema } from './report-query'

/**
 * The lease monitoring and rental discrepancy reports (ticket R-02), on the shared report endpoint pattern
 * `GET /api/v1/reports/{reportId}`. Read-only and open to every member role of the active company; Row Level Security
 * applies to every figure.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class MonitoringReportsController {
  constructor(private readonly reports: MonitoringReportsService) {}

  @Get('lease_monitoring')
  @ApiOperation({
    operationId: 'getLeaseMonitoringReport',
    summary: 'Lease monitoring: events by type, priority, status, property and age',
    description:
      'Every monitoring event of the company, open ones by default (new, under review, action required, in progress, as ' +
      'the monitoring list and the dashboard count them), each with its age on the "as at" date. Filters: propertyId, ' +
      'from/to (date identified), status (event status).',
  })
  @ApiOkResponse({ type: LeaseMonitoringResponseDto })
  leaseMonitoring(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'lease_monitoring'>> {
    return this.reports.leaseMonitoring(db, company.companyId, query)
  }

  @Get('rental_discrepancies')
  @ApiOperation({
    operationId: 'getRentalDiscrepanciesReport',
    summary: 'Rental discrepancies: billed rental against the escalated contractual rental per lease',
    description:
      'For every verified, monitored lease, the rental billed on its latest verified statement against the escalated ' +
      'rental at the billed period\'s start, with the company\'s tolerance and the calculation step by step (the lease ' +
      'monitoring scan\'s comparison), linked to the event raised for the statement; plus open discrepancy events on ' +
      'earlier statements. Filters: propertyId, from/to (billing period start), status (outside_tolerance, within_tolerance).',
  })
  @ApiOkResponse({ type: RentalDiscrepanciesResponseDto })
  rentalDiscrepancies(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'rental_discrepancies'>> {
    return this.reports.rentalDiscrepancies(db, company.companyId, query)
  }
}
