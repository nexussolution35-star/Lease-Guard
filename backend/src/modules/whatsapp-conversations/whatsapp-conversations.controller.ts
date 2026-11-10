import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Communication, WhatsAppConversation, WhatsAppConversationSummary, WhatsAppHandover } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CommunicationDto } from '../communications/dto/communication.dto'
import {
  AssignHandoverBodyDto,
  ReplyBodyDto,
  ResolveHandoverBodyDto,
  WhatsAppConversationDto,
  WhatsAppConversationListQueryDto,
  WhatsAppConversationPageDto,
  WhatsAppHandoverDto,
} from './dto/whatsapp-conversation.dto'
import { WhatsAppConversationActionsService } from './whatsapp-conversation-actions.service'
import { assignHandoverBodySchema, conversationListQuerySchema, replyBodySchema, resolveHandoverBodySchema } from './whatsapp-conversations.schemas'
import { WhatsAppConversationsService } from './whatsapp-conversations.service'

/**
 * The active company's WhatsApp conversations inbox: messages people sent to the company's receiving numbers,
 * threaded per contact and number. Every member may read it, like communications; company writers (company_admin,
 * property_manager) take conversations over, assign and resolve handovers, and reply to contacts (ticket 07).
 * Company scoping is applied per route, so the writer routes run the membership guard once.
 */
@ApiTags('whatsapp-conversations')
@Controller('whatsapp/conversations')
export class WhatsAppConversationsController {
  constructor(
    private readonly conversations: WhatsAppConversationsService,
    private readonly actions: WhatsAppConversationActionsService,
  ) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listWhatsAppConversations', summary: "The active company's WhatsApp conversations, most recent first" })
  @ApiOkResponse({ type: WhatsAppConversationPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(conversationListQuerySchema)) query: WhatsAppConversationListQueryDto,
  ): Promise<Page<WhatsAppConversationSummary>> {
    return this.conversations.list(db, company.companyId, user.userId, query)
  }

  @Get(':conversationId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getWhatsAppConversation', summary: 'One conversation with its latest messages, oldest first' })
  @ApiOkResponse({ type: WhatsAppConversationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such conversation in the active company' })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<WhatsAppConversation> {
    return this.conversations.get(db, company.companyId, conversationId)
  }

  @Post(':conversationId/handover/accept')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'acceptWhatsAppHandover',
    summary: 'Take a conversation over',
    description:
      "Accepts the conversation's open handover for the caller, or starts one the caller accepts at once. Repeating it is harmless. " +
      'Refused (409) when a colleague has already accepted it: assign it to yourself to take it from them.',
  })
  @ApiOkResponse({ type: WhatsAppHandoverDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such conversation in the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'A colleague has already accepted it' })
  accept(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<WhatsAppHandover> {
    return this.actions.accept(db, company.companyId, conversationId)
  }

  @Post(':conversationId/handover/assign')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'assignWhatsAppHandover',
    summary: 'Hand a conversation to a colleague',
    description:
      'Assigns the conversation (starting a handover when it has none) to an active company admin or property manager of the company. ' +
      'It stays open until that person accepts it; assigning it to yourself accepts it.',
  })
  @ApiOkResponse({ type: WhatsAppHandoverDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such conversation in the active company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The assignee cannot handle conversations of this company' })
  assign(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body(new ZodValidationPipe(assignHandoverBodySchema)) body: AssignHandoverBodyDto,
  ): Promise<WhatsAppHandover> {
    return this.actions.assign(db, company.companyId, conversationId, body.userId)
  }

  @Post(':conversationId/handover/resolve')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'resolveWhatsAppHandover', summary: "Resolve a conversation's handover", description: 'Records who resolved it, when, and an optional note.' })
  @ApiOkResponse({ type: WhatsAppHandoverDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such conversation in the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The conversation has no open handover' })
  resolve(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body(new ZodValidationPipe(resolveHandoverBodySchema)) body: ResolveHandoverBodyDto,
  ): Promise<WhatsAppHandover> {
    return this.actions.resolve(db, company.companyId, conversationId, body.note)
  }

  @Post(':conversationId/replies')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'replyToWhatsAppContact',
    summary: 'Reply to the contact of a conversation',
    description:
      "Free text to the conversation's contact, sent from the number the conversation came in on, approved by the caller and queued for delivery. " +
      "Refused (422, listing every reason) for a tenant (tenants only receive approved statement and payment messages), outside WhatsApp's " +
      "24-hour customer service window (from the contact's last message), when WhatsApp has not shared the contact's number, when the " +
      "conversation's number is not connected, or for banking details. The delivery worker checks the same rules again before it sends.",
  })
  @ApiCreatedResponse({ type: CommunicationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such conversation in the active company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The reply may not be sent; lists every reason' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Database or delivery queue unavailable' })
  reply(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body(new ZodValidationPipe(replyBodySchema)) body: ReplyBodyDto,
  ): Promise<Communication> {
    return this.actions.reply(db, company.companyId, conversationId, body.body)
  }
}
