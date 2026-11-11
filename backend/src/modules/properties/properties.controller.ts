import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
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
import type { Property } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreatePropertyDto, PropertyDto, PropertyListQueryDto, PropertyPageDto, UpdatePropertyDto } from './dto/property.dto'
import { createPropertyBodySchema, propertyListQuerySchema, updatePropertyBodySchema } from './properties.schemas'
import { PropertiesService } from './properties.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the
// company guards twice.
@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @CompanyScoped()
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
  @CompanyScoped()
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

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createProperty',
    summary: 'Create a property (company admins and property managers)',
    description:
      'The manager must be a company admin or property manager of the company; the owner, if any, a member. The code is ' +
      'upper-cased, unique in the company and fixed once created. The database records the audit entry.',
  })
  @ApiCreatedResponse({ type: PropertyDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The code is already used in this company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The manager or owner does not qualify' })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createPropertyBodySchema)) body: CreatePropertyDto,
  ): Promise<Property> {
    return this.properties.create(db, company.companyId, body)
  }

  @Patch(':propertyId')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateProperty',
    summary: 'Change a property (company admins and property managers)',
    description: 'Omitted fields are unchanged. The code cannot change. An archived property must be restored first (422).',
  })
  @ApiOkResponse({ type: PropertyDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'Archived, or the manager or owner does not qualify' })
  update(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodValidationPipe(updatePropertyBodySchema)) body: UpdatePropertyDto,
  ): Promise<Property> {
    return this.properties.update(db, company.companyId, propertyId, body)
  }

  @Post(':propertyId/archive')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'archiveProperty',
    summary: 'Archive a property (company admins and property managers)',
    description:
      'An archived property is kept with its history and is read-only until restored. Refused (409) while the property ' +
      'has a lease that has not ended. Archiving an archived property returns it unchanged.',
  })
  @ApiOkResponse({ type: PropertyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The property has leases that have not ended' })
  archive(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ): Promise<Property> {
    return this.properties.archive(db, company.companyId, propertyId)
  }

  @Post(':propertyId/restore')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'restoreProperty',
    summary: 'Restore an archived property (company admins and property managers)',
    description: 'The property becomes active again. Restoring a property that is not archived returns it unchanged.',
  })
  @ApiOkResponse({ type: PropertyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  restore(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ): Promise<Property> {
    return this.properties.restore(db, company.companyId, propertyId)
  }
}
