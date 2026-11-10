import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Lease } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { LeaseDto, LeaseListQueryDto, LeasePageDto } from './dto/lease.dto'
import { leaseListQuerySchema } from './leases.schemas'
import { LeasesService } from './leases.service'

// CompanyScoped is applied per route (not on the class) so the writer-only route does not run the
// company guards twice.
@ApiTags('leases')
@Controller('leases')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listLeases', summary: 'List leases in the active company' })
  @ApiOkResponse({ type: LeasePageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(leaseListQuerySchema)) query: LeaseListQueryDto,
  ): Promise<Page<Lease>> {
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
