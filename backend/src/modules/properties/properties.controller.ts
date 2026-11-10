import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Property } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { PropertyDto, PropertyListQueryDto, PropertyPageDto } from './dto/property.dto'
import { propertyListQuerySchema } from './properties.schemas'
import { PropertiesService } from './properties.service'

@ApiTags('properties')
@CompanyScoped()
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @ApiOperation({ operationId: 'listProperties', summary: 'List properties in the active company' })
  @ApiOkResponse({ type: PropertyPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(propertyListQuerySchema)) query: PropertyListQueryDto,
  ): Promise<Page<Property>> {
    return this.properties.list(db, company.companyId, query)
  }

  @Get(':propertyId')
  @ApiOperation({ operationId: 'getProperty', summary: 'Get one property' })
  @ApiOkResponse({ type: PropertyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ): Promise<Property> {
    return this.properties.get(db, company.companyId, propertyId)
  }
}
