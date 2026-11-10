import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { WhatsAppConversation, WhatsAppConversationSummary } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { WhatsAppConversationDto, WhatsAppConversationListQueryDto, WhatsAppConversationPageDto } from './dto/whatsapp-conversation.dto'
import { conversationListQuerySchema } from './whatsapp-conversations.schemas'
import { WhatsAppConversationsService } from './whatsapp-conversations.service'

/**
 * The active company's WhatsApp conversations inbox (read-only in this version): messages people sent to the
 * company's receiving numbers, threaded per contact and number. Every member may read it, like communications.
 */
@ApiTags('whatsapp-conversations')
@CompanyScoped()
@Controller('whatsapp/conversations')
export class WhatsAppConversationsController {
  constructor(private readonly conversations: WhatsAppConversationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listWhatsAppConversations', summary: "The active company's WhatsApp conversations, most recent first" })
  @ApiOkResponse({ type: WhatsAppConversationPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(conversationListQuerySchema)) query: WhatsAppConversationListQueryDto,
  ): Promise<Page<WhatsAppConversationSummary>> {
    return this.conversations.list(db, company.companyId, query)
  }

  @Get(':conversationId')
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
}
