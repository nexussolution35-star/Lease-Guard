import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Unit } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { UnitDto, UnitListQueryDto, UnitPageDto } from './dto/unit.dto'
import { unitListQuerySchema } from './units.schemas'
import { UnitsService } from './units.service'

@ApiTags('units')
@CompanyScoped()
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @ApiOperation({ operationId: 'listUnits', summary: 'List units in the active company' })
  @ApiOkResponse({ type: UnitPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(unitListQuerySchema)) query: UnitListQueryDto,
  ): Promise<Page<Unit>> {
    return this.units.list(db, company.companyId, query)
  }

  @Get(':unitId')
  @ApiOperation({ operationId: 'getUnit', summary: 'Get one unit' })
  @ApiOkResponse({ type: UnitDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('unitId', new ParseUUIDPipe()) unitId: string,
  ): Promise<Unit> {
    return this.units.get(db, company.companyId, unitId)
  }
}
