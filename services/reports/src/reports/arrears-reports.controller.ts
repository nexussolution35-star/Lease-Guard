import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { ArrearsReportsService } from './arrears-reports.service'
import { ArrearsResponseDto, PaymentArrangementsResponseDto } from './dto/arrears.dto'
import { ReportQueryDto } from './dto/report-common.dto'
import { reportQuerySchema } from './report-query'

/**
 * The arrears and payment arrangements reports (ticket R-05), on the shared report endpoint pattern
 * `GET /api/v1/reports/{reportId}`. Read-only and open to every member role of the active company; Row Level Security
 * applies to every figure. Monitoring summaries only: LeaseGuard never takes payments.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class ArrearsReportsController {
  constructor(private readonly reports: ArrearsReportsService) {}

  @Get('arrears')
  @ApiOperation({
    operationId: 'getArrearsReport',
    summary: 'Arrears ageing: outstanding per tenant and unit from the latest verified statement, aged into the company\'s buckets',
    description:
      'Counted as the Statements page and the dashboard count: the latest verified statement of each tenant\'s unit (the ' +
      'lease without a unit), zero and credit balances left out, aged from the statement date into the company\'s arrears ' +
      'monitoring buckets. A tenant under an active payment arrangement stays in arrears and is marked, with whether its ' +
      'reminders are paused. Filters: propertyId, status (under_arrangement, no_arrangement).',
  })
  @ApiOkResponse({ type: ArrearsResponseDto })
  arrears(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'arrears'>> {
    return this.reports.arrears(db, company.companyId, query)
  }

  @Get('payment_arrangements')
  @ApiOperation({
    operationId: 'getPaymentArrangementsReport',
    summary: 'Payment arrangements: status, schedule progress, missed and overdue instalments',
    description:
      'Every arrangement (proposed, active, completed, defaulted, cancelled) with the instalments recorded as paid, missed ' +
      'and, while in force, overdue (past the due date plus the company\'s grace days) and the next instalment. Filters: ' +
      'propertyId, from/to (the date agreed), status (arrangement status). Records only: no payment is taken.',
  })
  @ApiOkResponse({ type: PaymentArrangementsResponseDto })
  paymentArrangements(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'payment_arrangements'>> {
    return this.reports.paymentArrangements(db, company.companyId, query)
  }
}
