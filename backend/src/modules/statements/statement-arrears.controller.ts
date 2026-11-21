import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { StatementArrearsSummary } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { StatementArrearsSummaryDto } from './dto/statement-arrears.dto'
import { StatementArrearsService } from './statement-arrears.service'

// Registered before StatementsController so `statements/arrears` is not taken for a statement id.
@ApiTags('statements')
@Controller('statements/arrears')
export class StatementArrearsController {
  constructor(private readonly arrears: StatementArrearsService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getStatementArrears',
    summary: 'Outstanding balances and arrears ageing from verified statements',
    description:
      "Only each tenant's latest VERIFIED statement counts; statements in review never do. Balances are aged from the " +
      "statement date into the company's arrears monitoring buckets. Tenants under an active payment arrangement are " +
      'marked. Each entry names the statement its balance comes from. Monitoring figures, never transactions.',
  })
  @ApiOkResponse({ type: StatementArrearsSummaryDto })
  summary(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<StatementArrearsSummary> {
    return this.arrears.summary(db, company.companyId)
  }
}
