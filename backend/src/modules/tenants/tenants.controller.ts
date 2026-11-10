import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Tenant } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { TenantDto, TenantListQueryDto, TenantPageDto } from './dto/tenant.dto'
import { tenantListQuerySchema } from './tenants.schemas'
import { TenantsService } from './tenants.service'

@ApiTags('tenants')
@CompanyScoped()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @ApiOperation({ operationId: 'listTenants', summary: 'List tenants in the active company' })
  @ApiOkResponse({ type: TenantPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(tenantListQuerySchema)) query: TenantListQueryDto,
  ): Promise<Page<Tenant>> {
    return this.tenants.list(db, company.companyId, query)
  }

  @Get(':tenantId')
  @ApiOperation({ operationId: 'getTenant', summary: 'Get one tenant' })
  @ApiOkResponse({ type: TenantDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
  ): Promise<Tenant> {
    return this.tenants.get(db, company.companyId, tenantId)
  }
}
