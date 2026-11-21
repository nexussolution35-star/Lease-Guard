import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { Tenant, TenantListItem } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreateTenantDto, TenantDto, TenantListQueryDto, TenantPageDto, UpdateTenantDto, ValidateTenantWhatsAppDto } from './dto/tenant.dto'
import { createTenantBodySchema, tenantListQuerySchema, updateTenantBodySchema, validateTenantWhatsAppBodySchema } from './tenants.schemas'
import { TenantsService } from './tenants.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the
// company guards twice.
@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listTenants',
    summary: 'List tenants in the active company',
    description: "Each tenant carries its current lease (reference, unit and property) and its lease count. `propertyId` keeps tenants with a lease in that property.",
  })
  @ApiOkResponse({ type: TenantPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(tenantListQuerySchema)) query: TenantListQueryDto,
  ): Promise<Page<TenantListItem>> {
    return this.tenants.list(db, company.companyId, query)
  }

  @Get(':tenantId')
  @CompanyScoped()
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

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createTenant',
    summary: 'Create a tenant (company admins and property managers)',
    description:
      'The WhatsApp number is stored in E.164 and starts unvalidated: automated communication stays off until it is ' +
      'validated. An invalid number is 400 with the format to use. The database records the audit entry.',
  })
  @ApiCreatedResponse({ type: TenantDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createTenantBodySchema)) body: CreateTenantDto,
  ): Promise<Tenant> {
    return this.tenants.create(db, company.companyId, body)
  }

  @Patch(':tenantId')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateTenant',
    summary: 'Change a tenant (company admins and property managers)',
    description:
      'Omitted fields are unchanged; empty or null clears an optional field. A different WhatsApp number is ' +
      'unvalidated again, which turns automated communication off until it is validated; the audit entry records it.',
  })
  @ApiOkResponse({ type: TenantDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  update(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body(new ZodValidationPipe(updateTenantBodySchema)) body: UpdateTenantDto,
  ): Promise<Tenant> {
    return this.tenants.update(db, company.companyId, tenantId, body)
  }

  @Post(':tenantId/whatsapp-validation')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'validateTenantWhatsAppNumber',
    summary: "Validate a tenant's WhatsApp number (company admins and property managers)",
    description:
      'Records that a member confirmed the number with the tenant (PRD §5.4: numbers must be validated before automated ' +
      'communication is enabled). `whatsappNumber` is the number the member checked and must still be the number on ' +
      'record: 409 when it changed in the meantime. Stamps who validated it and when, and records a verify audit entry. ' +
      'Validating a validated number returns the tenant unchanged. Changing the number later makes it unvalidated again.',
  })
  @ApiOkResponse({ type: TenantDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  validateWhatsApp(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body(new ZodValidationPipe(validateTenantWhatsAppBodySchema)) body: ValidateTenantWhatsAppDto,
  ): Promise<Tenant> {
    return this.tenants.validateWhatsApp(db, company.companyId, tenantId, body)
  }
}
