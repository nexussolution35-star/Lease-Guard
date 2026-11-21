import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ReportEnvelope } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, UserDb, ZodValidationPipe, type CompanyContext, type DbClient } from '@leaseguard/service-kit'

import { ReportQueryDto } from './dto/report-common.dto'
import { DepositsGuaranteesResponseDto } from './dto/security.dto'
import { reportQuerySchema } from './report-query'
import { SecurityReportsService } from './security-reports.service'

/**
 * The deposits and guarantees report (ticket R-04): `GET /api/v1/reports/deposits_guarantees` with the shared query.
 * Read-only and open to every member role of the active company; Row Level Security applies to every figure.
 */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class SecurityReportsController {
  constructor(private readonly reports: SecurityReportsService) {}

  @Get('deposits_guarantees')
  @ApiOperation({
    operationId: 'getDepositsGuaranteesReport',
    summary: 'Deposits and guarantees: per verified lease, deposit and guarantee held, required cover, shortfall and guarantee expiry',
    description:
      'Verified leases in a monitored status (active, expiring) with a deposit or a bank guarantee. Required cover is the ' +
      'basis months times the rental the verified terms expect as at today (escalations applied), as lease monitoring ' +
      'works it out; a guarantee is expiring inside the company\'s guarantee expiry notice days. Filters: propertyId, ' +
      'from/to (guarantee expiry date), status (guarantee state: active, expiring, expired, released, called). A monitoring report, never a transaction.',
  })
  @ApiOkResponse({ type: DepositsGuaranteesResponseDto })
  depositsGuarantees(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
  ): Promise<ReportEnvelope<'deposits_guarantees'>> {
    return this.reports.depositsGuarantees(db, company.companyId, query)
  }
}
