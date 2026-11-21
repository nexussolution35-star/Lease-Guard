import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Unit, UnitListItem } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreateUnitDto, UnitDto, UnitListQueryDto, UnitPageDto, UpdateUnitDto } from './dto/unit.dto'
import { createUnitBodySchema, unitListQuerySchema, updateUnitBodySchema } from './units.schemas'
import { UnitsService } from './units.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the
// company guards twice.
@ApiTags('units')
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listUnits', summary: 'List units in the active company' })
  @ApiOkResponse({ type: UnitPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(unitListQuerySchema)) query: UnitListQueryDto,
  ): Promise<Page<UnitListItem>> {
    return this.units.list(db, company.companyId, query)
  }

  @Get(':unitId')
  @CompanyScoped()
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

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createUnit',
    summary: 'Create a unit (company admins and property managers)',
    description:
      'The property must be in the company and not archived; the unit number is unique within the property. The current ' +
      'tenant and lease are derived from the active lease and cannot be sent. The database records the audit entry.',
  })
  @ApiCreatedResponse({ type: UnitDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The unit number is already used in this property' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The property is not in this company, or it is archived' })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createUnitBodySchema)) body: CreateUnitDto,
  ): Promise<Unit> {
    return this.units.create(db, company.companyId, body)
  }

  @Patch(':unitId')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateUnit',
    summary: 'Change a unit (company admins and property managers)',
    description:
      'Omitted fields are unchanged; the property cannot change. A unit with a current lease stays occupied, and the units ' +
      'of an archived property are read-only (422). Occupancy status changes are audited.',
  })
  @ApiOkResponse({ type: UnitDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The unit number is already used in this property' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The property is archived, or the leased unit must stay occupied' })
  update(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('unitId', new ParseUUIDPipe()) unitId: string,
    @Body(new ZodValidationPipe(updateUnitBodySchema)) body: UpdateUnitDto,
  ): Promise<Unit> {
    return this.units.update(db, company.companyId, unitId, body)
  }
}
