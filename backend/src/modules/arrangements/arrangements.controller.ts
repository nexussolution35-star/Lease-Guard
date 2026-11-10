import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { PaymentArrangement } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ArrangementListQueryDto, PaymentArrangementDto, PaymentArrangementPageDto } from './dto/arrangement.dto'
import { arrangementListQuerySchema } from './arrangements.schemas'
import { ArrangementsService } from './arrangements.service'

@ApiTags('arrangements')
@CompanyScoped()
@Controller('arrangements')
export class ArrangementsController {
  constructor(private readonly arrangements: ArrangementsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listArrangements',
    summary: 'List payment arrangements in the active company',
    description: 'Monitoring records of agreements; LeaseGuard never collects or processes payments.',
  })
  @ApiOkResponse({ type: PaymentArrangementPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(arrangementListQuerySchema)) query: ArrangementListQueryDto,
  ): Promise<Page<PaymentArrangement>> {
    return this.arrangements.list(db, company.companyId, query)
  }

  @Get(':arrangementId')
  @ApiOperation({ operationId: 'getArrangement', summary: 'Get one payment arrangement with its instalments' })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
  ): Promise<PaymentArrangement> {
    return this.arrangements.get(db, company.companyId, arrangementId)
  }
}
