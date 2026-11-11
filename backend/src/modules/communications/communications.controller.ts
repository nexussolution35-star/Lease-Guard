import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Communication, CommunicationAnalytics } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CommunicationAnalyticsService } from './communication-analytics.service'
import type { ApprovalDecisionResult, PendingApproval } from './communications.mapper'
import {
  approvalQueueQuerySchema,
  approveCommunicationBodySchema,
  communicationAnalyticsQuerySchema,
  communicationListQuerySchema,
  rejectCommunicationBodySchema,
} from './communications.schemas'
import { CommunicationsService } from './communications.service'
import {
  ApprovalDecisionResultDto,
  ApprovalQueueQueryDto,
  ApproveCommunicationBodyDto,
  CommunicationAnalyticsDto,
  CommunicationAnalyticsQueryDto,
  CommunicationDto,
  CommunicationListQueryDto,
  CommunicationPageDto,
  PendingApprovalPageDto,
  RejectCommunicationBodyDto,
} from './dto/communication.dto'
import { MessageApprovalsService } from './message-approvals.service'

// Company scoping is applied per route: reads allow every member, decisions only writers. A class-level
// @CompanyScoped() would run the membership guard twice on the decision routes.
@ApiTags('communications')
@Controller('communications')
export class CommunicationsController {
  constructor(
    private readonly communications: CommunicationsService,
    private readonly approvals: MessageApprovalsService,
    private readonly analytics: CommunicationAnalyticsService,
  ) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listCommunications', summary: 'List messages in the active company' })
  @ApiOkResponse({ type: CommunicationPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(communicationListQuerySchema)) query: CommunicationListQueryDto,
  ): Promise<Page<Communication>> {
    return this.communications.list(db, company.companyId, query)
  }

  // Declared before `:communicationId` so the literal path is matched first.
  @Get('approvals')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listPendingApprovals',
    summary: 'Messages awaiting approval',
    description: 'Open approval requests with the message each one is about, oldest request first by default.',
  })
  @ApiOkResponse({ type: PendingApprovalPageDto })
  listPendingApprovals(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(approvalQueueQuerySchema)) query: ApprovalQueueQueryDto,
  ): Promise<Page<PendingApproval>> {
    return this.communications.listPendingApprovals(db, company.companyId, query)
  }

  // Declared before `:communicationId` so the literal path is matched first.
  @Get('analytics')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getCommunicationAnalytics',
    summary: "The active company's WhatsApp communication figures over a date range",
    description:
      'Every member of the company. South African calendar days, both inclusive; without dates the last 30 days, at ' +
      'most 366 days (400 otherwise). Messages count on the day they were recorded, by their current status; ' +
      'handovers on the day they were opened; AI agent runs on the day their message arrived. Only WhatsApp ' +
      'messages count; test messages are not communications. Computed by the database as the caller, so another ' +
      "company's records never count.",
  })
  @ApiOkResponse({ type: CommunicationAnalyticsDto })
  getAnalytics(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(communicationAnalyticsQuerySchema)) query: CommunicationAnalyticsQueryDto,
  ): Promise<CommunicationAnalytics> {
    return this.analytics.figures(db, company.companyId, query)
  }

  @Get(':communicationId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getCommunication', summary: 'Get one message' })
  @ApiOkResponse({ type: CommunicationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('communicationId', new ParseUUIDPipe()) communicationId: string,
  ): Promise<Communication> {
    return this.communications.get(db, company.companyId, communicationId)
  }

  @Post(':communicationId/approve')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'approveCommunication',
    summary: 'Approve a message awaiting approval and queue it for delivery',
    description:
      'Records the approval, with the caller as the approver, and hands the message to the delivery queue. ' +
      'Any company_admin or property_manager may approve, including the person who requested the approval. ' +
      'Refused (422, listing every reason) whenever delivery would refuse the message: it is not eligible for its ' +
      'recipient (tenants only receive statement and payment messages; no banking details), the recipient\'s ' +
      'WhatsApp number changed, the company WhatsApp account is not connected, its template is not approved or ' +
      'does not match, or an approval on record does not name its approver. Refused (409) when the message is ' +
      'no longer awaiting a decision.',
  })
  @ApiOkResponse({ type: ApprovalDecisionResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already decided or not awaiting approval' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'Delivery would refuse the message; lists every reason' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Database or delivery queue unavailable' })
  approve(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('communicationId', new ParseUUIDPipe()) communicationId: string,
    @Body(new ZodValidationPipe(approveCommunicationBodySchema)) body: ApproveCommunicationBodyDto,
  ): Promise<ApprovalDecisionResult> {
    // The approver is the signed-in caller: the database stamps it from the access token.
    return this.approvals.approve(db, company.companyId, communicationId, body)
  }

  @Post(':communicationId/reject')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'rejectCommunication',
    summary: 'Reject a message awaiting approval',
    description: 'Records the rejection with its reason; the message is never sent.',
  })
  @ApiOkResponse({ type: ApprovalDecisionResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already decided or not awaiting approval' })
  reject(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('communicationId', new ParseUUIDPipe()) communicationId: string,
    @Body(new ZodValidationPipe(rejectCommunicationBodySchema)) body: RejectCommunicationBodyDto,
  ): Promise<ApprovalDecisionResult> {
    // The approver is the signed-in caller: the database stamps it from the access token.
    return this.approvals.reject(db, company.companyId, communicationId, body)
  }
}
