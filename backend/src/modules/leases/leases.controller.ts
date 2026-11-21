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
import type { Lease, LeaseListItem } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreateLeaseDto, LeaseDto, LeaseListQueryDto, LeasePageDto, UpdateLeaseDto } from './dto/lease.dto'
import { createLeaseBodySchema, leaseListQuerySchema, updateLeaseBodySchema } from './leases.schemas'
import { LeasesService } from './leases.service'

// CompanyScoped is applied per route (not on the class) so the writer-only route does not run the
// company guards twice.
@ApiTags('leases')
@Controller('leases')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listLeases',
    summary: 'List leases in the active company',
    description: 'Search matches the lease reference or the tenant trading or legal name. Each item carries the tenant, property and unit names.',
  })
  @ApiOkResponse({ type: LeasePageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(leaseListQuerySchema)) query: LeaseListQueryDto,
  ): Promise<Page<LeaseListItem>> {
    return this.leases.list(db, company.companyId, query)
  }

  @Get(':leaseId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getLease', summary: 'Get one lease with its escalation, renewal, deposit and guarantee terms' })
  @ApiOkResponse({ type: LeaseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
  ): Promise<Lease> {
    return this.leases.get(db, company.companyId, leaseId)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createLease',
    summary: 'Create a lease (company admins and property managers)',
    description:
      'The lease starts unverified (pending verification unless draft) and is not used for financial monitoring until ' +
      'its terms are verified. The reference is upper-cased and unique in the company; the tenant, property and unit must ' +
      'belong to the company and the unit to the property, which must not be archived. The lease and its bank guarantee ' +
      'are written together and the database records the audit entries.',
  })
  @ApiCreatedResponse({ type: LeaseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The reference is already used in this company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The tenant, property and unit do not belong together' })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createLeaseBodySchema)) body: CreateLeaseDto,
  ): Promise<Lease> {
    return this.leases.create(db, company.companyId, body)
  }

  @Patch(':leaseId')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateLease',
    summary: 'Change a lease (company admins and property managers)',
    description:
      'Omitted fields are unchanged; escalation, renewal option, deposit and bank guarantee each replace the whole group, ' +
      'and null removes the deposit or the guarantee. A change to a term (parties, dates, rentals, due day, escalation, ' +
      'renewal option, deposit or guarantee) of a verified lease returns it to pending verification, audited, so ' +
      'unverified terms never drive monitoring. The parties cannot change once statements, arrangements, monitoring ' +
      'events or messages name the lease (422).',
  })
  @ApiOkResponse({ type: LeaseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The reference is already used in this company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The dates, parties or a database rule refuse the change' })
  update(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
    @Body(new ZodValidationPipe(updateLeaseBodySchema)) body: UpdateLeaseDto,
  ): Promise<Lease> {
    return this.leases.update(db, company.companyId, leaseId, body)
  }

  @Post(':leaseId/verify')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'verifyLease',
    summary: 'Mark the lease terms verified',
    description:
      'Verified terms may drive financial monitoring. The database records the verifier and time and writes ' +
      'the audit log. Verifying an already verified lease returns it unchanged.',
  })
  @ApiOkResponse({ type: LeaseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  verify(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
  ): Promise<Lease> {
    return this.leases.verify(db, company.companyId, leaseId)
  }
}
