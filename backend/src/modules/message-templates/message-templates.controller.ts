import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import { TEMPLATED_MESSAGE_TYPES, type MessageTemplateSettings, type MessageTypeTemplate, type TemplatedMessageType } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ChooseMessageTemplateDto, MessageTemplateSettingsDto, MessageTemplateSyncDto, MessageTypeTemplateDto } from './dto/message-template.dto'
import { chooseMessageTemplateBodySchema, templatedMessageTypeSchema } from './message-templates.schemas'
import { MessageTemplatesService } from './message-templates.service'

/** Settings → Message templates: the Meta-approved WhatsApp template that sends each LeaseGuard message type. */
@ApiTags('message-templates')
@Controller('message-templates')
export class MessageTemplatesController {
  constructor(private readonly templates: MessageTemplatesService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getMessageTemplateSettings',
    summary: 'Every templated message type with the WhatsApp template that sends it',
    description:
      'The five tenant types (statement and payment messages only), then the owner types; each with its audience, the ' +
      "chosen Meta template (name, language, text, variables, document attachment, Meta's status and reason) and whether " +
      'it can be sent now. Every member may read it.',
  })
  @ApiOkResponse({ type: MessageTemplateSettingsDto })
  getSettings(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<MessageTemplateSettings> {
    return this.templates.settings(db, company.companyId)
  }

  @Put(':messageType')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'chooseMessageTemplate',
    summary: 'Choose the Meta template that sends a message type (company admins)',
    description:
      'The template must be one of the company’s synced templates that Meta approved, not an authentication template, ' +
      'a Utility template for a tenant type, with LeaseGuard holding its text (numbered placeholders, no gaps), no banking ' +
      'details and, for a tenant type, no escalation, expiry, renewal, dispute, guarantee or deposit wording; and it must ' +
      'not already send another type. Refused with 422 and every reason. Audited on the template.',
  })
  @ApiParam({ name: 'messageType', enum: TEMPLATED_MESSAGE_TYPES, enumName: 'TemplatedMessageType' })
  @ApiOkResponse({ type: MessageTypeTemplateDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not a company admin' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such synced template in the active company' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The template cannot send this type (every reason)' })
  choose(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('messageType', new ZodValidationPipe(templatedMessageTypeSchema)) messageType: TemplatedMessageType,
    @Body(new ZodValidationPipe(chooseMessageTemplateBodySchema)) body: ChooseMessageTemplateDto,
  ): Promise<MessageTypeTemplate> {
    return this.templates.choose(db, company.companyId, messageType, body)
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'syncMessageTemplates',
    summary: 'Sync the templates from Meta again (company admins)',
    description:
      "Queues a sync of each connected number's WhatsApp Business Account in the worker: Meta's status, text and header " +
      'format of every template, reflected onto the chosen templates. Idempotent while a sync is waiting.',
  })
  @ApiAcceptedResponse({ type: MessageTemplateSyncDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'No WhatsApp number is connected' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Background processing is unavailable' })
  sync(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<{ queued: number; message: string }> {
    return this.templates.sync(db, company.companyId)
  }
}
