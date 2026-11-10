import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Company, OnboardingChecklist, WhatsAppAccountConfig } from '@leaseguard/domain'

import { Authenticated, CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { configureWhatsAppBodySchema, updateCompanyBodySchema } from './companies.schemas'
import { assertActiveCompany, CompaniesService } from './companies.service'
import { CompanyDto, ConfigureWhatsAppDto, OnboardingChecklistDto, UpdateCompanyDto, WhatsAppAccountConfigDto } from './dto/company.dto'

/**
 * The caller's companies. Listing and reading are not company-scoped (no X-Company-Id): the client uses
 * them to choose the active workspace, and membership is enforced by the query and by Row Level
 * Security. Configuring a company and its onboarding act on the active company: they are
 * company-scoped, and the path must name the X-Company-Id company. Access is declared per route,
 * because the two kinds need different OpenAPI security requirements.
 */
@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ operationId: 'listCompanies', summary: 'List the companies the caller is a member of' })
  @ApiOkResponse({ type: [CompanyDto] })
  list(@UserDb() db: DbClient, @CurrentUser() user: AuthenticatedUser): Promise<Company[]> {
    return this.companies.list(db, user.userId)
  }

  @Get(':companyId')
  @Authenticated()
  @ApiOperation({ operationId: 'getCompany', summary: 'Get one company the caller is a member of' })
  @ApiOkResponse({ type: CompanyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such company, or the caller is not a member' })
  get(
    @UserDb() db: DbClient,
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
  ): Promise<Company> {
    return this.companies.get(db, user.userId, companyId)
  }

  @Patch(':companyId')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'updateCompany',
    summary: 'Update the company profile and monitoring settings (company admins)',
    description:
      'The path must name the active company (X-Company-Id). Status, initials and the timezone are managed ' +
      'by Nexus and are not accepted. Tenant messages always require approval; it is not a company setting.',
  })
  @ApiOkResponse({ type: CompanyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  update(
    @UserDb() db: DbClient,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentCompany() company: CompanyContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body(new ZodValidationPipe(updateCompanyBodySchema)) body: UpdateCompanyDto,
  ): Promise<Company> {
    assertActiveCompany(companyId, company)
    return this.companies.update(db, user.userId, company.companyId, body)
  }

  @Put(':companyId/whatsapp')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'configureWhatsApp',
    summary: "Set the company's WhatsApp Business identifiers (company admins)",
    description:
      'Creates or replaces the configuration. The access token is never sent through the API: the reference is ' +
      'set by the server, and a new account or changed Meta ids are pending verification until Nexus verifies ' +
      'the connection. The path must name the active company (X-Company-Id).',
  })
  @ApiOkResponse({ type: WhatsAppAccountConfigDto })
  configureWhatsApp(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body(new ZodValidationPipe(configureWhatsAppBodySchema)) body: ConfigureWhatsAppDto,
  ): Promise<WhatsAppAccountConfig> {
    assertActiveCompany(companyId, company)
    return this.companies.configureWhatsApp(db, company.companyId, body)
  }

  @Get(':companyId/onboarding')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getOnboarding',
    summary: 'Onboarding checklist of the active company',
    description:
      'One flag per step and whether every required step is done. Inviting a team is recommended, not required. ' +
      'The path must name the active company (X-Company-Id).',
  })
  @ApiOkResponse({ type: OnboardingChecklistDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  onboarding(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
  ): Promise<OnboardingChecklist> {
    assertActiveCompany(companyId, company)
    return this.companies.onboarding(db, company.companyId)
  }
}
