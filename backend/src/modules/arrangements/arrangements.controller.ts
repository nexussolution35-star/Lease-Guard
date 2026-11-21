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
import type { PaymentArrangementListItem } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  ArrangementListQueryDto,
  CancelArrangementDto,
  CloseArrangementDto,
  CreateArrangementDto,
  InstallmentOutcomeDto,
  PaymentArrangementDto,
  PaymentArrangementPageDto,
  UpdateArrangementDto,
} from './dto/arrangement.dto'
import {
  arrangementListQuerySchema,
  cancelArrangementBodySchema,
  closeArrangementBodySchema,
  createArrangementBodySchema,
  installmentOutcomeBodySchema,
  updateArrangementBodySchema,
} from './arrangements.schemas'
import { ArrangementsService } from './arrangements.service'

const MONITORING_ONLY = 'A monitoring record of an agreement: LeaseGuard never collects, processes or verifies a payment.'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the
// company guards twice.
@ApiTags('arrangements')
@Controller('arrangements')
export class ArrangementsController {
  constructor(private readonly arrangements: ArrangementsService) {}

  @Get()
  @CompanyScoped()
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
  ): Promise<Page<PaymentArrangementListItem>> {
    return this.arrangements.list(db, company.companyId, query)
  }

  @Get(':arrangementId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getArrangement', summary: 'Get one payment arrangement with its instalments' })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.get(db, company.companyId, arrangementId)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createArrangement',
    summary: 'Record a payment arrangement (company admins and property managers)',
    description:
      `${MONITORING_ONLY} The lease is leaseId, else the tenant's single lease in force at the property (and unit). The ` +
      'instalment schedule is generated from the terms (each instalment the agreed amount, the last the remainder); a ' +
      'given final instalment date must agree with it. While active it pauses the tenant\'s normal arrears reminders. ' +
      '409 when the tenant already has an active arrangement; 422 for terms or a lease that do not fit, in words. Audited.',
  })
  @ApiCreatedResponse({ type: PaymentArrangementDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The tenant already has an active arrangement' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The terms or the lease do not fit' })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createArrangementBodySchema)) body: CreateArrangementDto,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.create(db, company.companyId, body)
  }

  @Patch(':arrangementId')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateArrangement',
    summary: 'Edit a proposed or active payment arrangement (company admins and property managers)',
    description:
      'Omitted fields are unchanged; status moves proposed -> active only. Changed terms generate the schedule again, ' +
      'refused (409) once an instalment outcome is recorded. 409 for a closed arrangement or a second active one for ' +
      'the tenant; 422 for terms that do not fit. Audited with the changed fields.',
  })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto })
  update(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
    @Body(new ZodValidationPipe(updateArrangementBodySchema)) body: UpdateArrangementDto,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.update(db, company.companyId, arrangementId, body)
  }

  @Post(':arrangementId/close')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'closeArrangement',
    summary: 'Close an active payment arrangement as completed or defaulted (company admins and property managers)',
    description:
      'Normal arrears reminders resume for the tenant. The arrangement is read-only from then on. Stamps who and when; ' +
      'audited. 409 when it is already closed or still proposed (cancel a proposal instead).',
  })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  close(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
    @Body(new ZodValidationPipe(closeArrangementBodySchema)) body: CloseArrangementDto,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.close(db, company.companyId, arrangementId, body)
  }

  @Post(':arrangementId/cancel')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'cancelArrangement',
    summary: 'Cancel a proposed or active payment arrangement, with the reason (company admins and property managers)',
    description: 'Normal arrears reminders resume for the tenant. Stamps who, when and why; audited. 409 when it is already closed.',
  })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  cancel(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
    @Body(new ZodValidationPipe(cancelArrangementBodySchema)) body: CancelArrangementDto,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.cancel(db, company.companyId, arrangementId, body)
  }

  @Post(':arrangementId/installments/:installmentId/outcome')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'recordInstallmentOutcome',
    summary: 'Record an instalment as paid, missed or waived, or clear it (company admins and property managers)',
    description:
      `${MONITORING_ONLY} The outcome is the property manager's confirmation (from an updated statement or the tenant). ` +
      'A future instalment cannot be missed. Only while the arrangement is active (409 otherwise). Stamps who and when; ' +
      'audited on the arrangement.',
  })
  @ApiOkResponse({ type: PaymentArrangementDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  recordInstallmentOutcome(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('arrangementId', new ParseUUIDPipe()) arrangementId: string,
    @Param('installmentId', new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(installmentOutcomeBodySchema)) body: InstallmentOutcomeDto,
  ): Promise<PaymentArrangementListItem> {
    return this.arrangements.recordInstallmentOutcome(db, company.companyId, arrangementId, installmentId, body)
  }
}
