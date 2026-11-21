import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { DashboardSummary } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { DashboardService } from './dashboard.service'
import { DashboardSummaryDto } from './dto/dashboard-summary.dto'

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getDashboardSummary',
    summary: 'The dashboard figures of the active company',
    description:
      'Every PRD §7.1 figure in one request: properties, units, occupied units, active leases, outstanding balances and ' +
      'tenants in arrears (from the latest verified statement per unit, as GET /statements/arrears), open escalation ' +
      'discrepancy, lease expiry, renewal deadline and guarantee expiry events, active payment arrangements, statements ' +
      'waiting for review and messages awaiting approval. Every member may read it. Monitoring figures, never transactions.',
  })
  @ApiOkResponse({ type: DashboardSummaryDto })
  summary(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<DashboardSummary> {
    return this.dashboard.summary(db, company.companyId)
  }
}
