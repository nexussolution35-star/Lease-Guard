import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { CompanyInvitation } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreateInvitationDto, InvitationDto, InvitationListQueryDto, InvitationPageDto } from './dto/invitation.dto'
import { createInvitationBodySchema, invitationListQuerySchema } from './invitations.schemas'
import { InvitationsService } from './invitations.service'

@ApiTags('invitations')
@CompanyScoped({ roles: ['company_admin'] })
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listInvitations', summary: 'List invitations to the active company (company admins)' })
  @ApiOkResponse({ type: InvitationPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(invitationListQuerySchema)) query: InvitationListQueryDto,
  ): Promise<Page<CompanyInvitation>> {
    return this.invitations.list(db, company.companyId, query)
  }

  @Post()
  @ApiOperation({
    operationId: 'createInvitation',
    summary: 'Invite someone to the active company (company admins)',
    description:
      'Records a pending invitation and queues it for sending; the email is sent by the background worker ' +
      'through Supabase Auth and the status moves to sent (or failed). No membership is created until the ' +
      'invitee accepts (POST /me/invitations/{invitationId}/accept). Refused when the email already has an ' +
      'open invitation or belongs to a member of the company.',
  })
  @ApiCreatedResponse({ type: InvitationDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Open invitation or membership already exists for this email' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Database or invitation queue unavailable' })
  create(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createInvitationBodySchema)) body: CreateInvitationDto,
  ): Promise<CompanyInvitation> {
    return this.invitations.create(db, company.companyId, body)
  }

  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'revokeInvitation',
    summary: 'Revoke a pending or sent invitation (company admins)',
    description: 'The invitation can no longer be accepted. Revoking never removes a membership.',
  })
  @ApiOkResponse({ type: InvitationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The invitation is no longer pending or sent' })
  revoke(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
  ): Promise<CompanyInvitation> {
    return this.invitations.revoke(db, company.companyId, invitationId)
  }

  @Post(':invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'resendInvitation',
    summary: 'Send a pending, sent or failed invitation again (company admins)',
    description:
      'Queues the invitation for sending again and returns it unchanged; the background worker records the new ' +
      'send (a failed invitation is reset by the worker). A user who already confirmed their email gets no new ' +
      'email; they see the invitation in the app. Never creates or changes a membership.',
  })
  @ApiOkResponse({ type: InvitationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The invitation is not pending, sent or failed' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Database or invitation queue unavailable' })
  resend(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
  ): Promise<CompanyInvitation> {
    return this.invitations.resend(db, company.companyId, invitationId)
  }
}
