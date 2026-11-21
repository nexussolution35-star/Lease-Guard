import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  TEMPLATE_APPROVAL_STATUSES,
  TEMPLATED_MESSAGE_TYPES,
  type MessageTemplateSettings,
  type MessageTypeTemplate,
  type MessageTypeTemplateMapping,
  type TemplateApprovalStatus,
  type TemplatedMessageType,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { chooseMessageTemplateBodySchema } from '../message-templates.schemas'

/** The Meta template a company admin chose for a message type. */
export class MessageTypeTemplateMappingDto implements MessageTypeTemplateMapping {
  @ApiProperty({ format: 'uuid', description: "The company's message template that messages of the type name" }) templateId!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'The synced Meta template with the same name and language, while Meta holds it' })
  whatsappTemplateId?: string
  @ApiProperty({ description: 'Name registered with Meta' }) metaTemplateName!: string
  @ApiProperty({ description: 'Meta language code, e.g. en_ZA' }) language!: string
  @ApiProperty({ enum: ['utility', 'marketing'] }) category!: string
  @ApiProperty({ description: 'The text as chosen, with numbered placeholders {{1}}, {{2}}…' }) body!: string
  @ApiProperty({ type: [String], description: 'What each placeholder holds, in order' }) variables!: string[]
  @ApiProperty({ enum: TEMPLATE_APPROVAL_STATUSES, enumName: 'TemplateApprovalStatus', description: "LeaseGuard's reading of Meta's status" })
  approvalStatus!: TemplateApprovalStatus
  @ApiPropertyOptional({ description: "Meta's status of the synced template, e.g. APPROVED, PAUSED; absent once Meta no longer holds it" })
  metaStatus?: string
  @ApiPropertyOptional({ description: "Meta's reason for rejecting or pausing it" }) rejectedReason?: string
  @ApiProperty({ description: 'A document header: the template can carry the statement PDF' }) supportsDocumentAttachment!: boolean
  @ApiProperty({ description: "Meta's text differs from the text chosen (edited in WhatsApp Manager): choose it again" })
  metaBodyChanged!: boolean
  @ApiProperty({ format: 'date-time' }) mappedAt!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Who chose it; absent when the member has left the company' }) mappedByUserId?: string
  @ApiPropertyOptional() mappedByName?: string
}

export class MessageTypeTemplateDto implements MessageTypeTemplate {
  @ApiProperty({ enum: TEMPLATED_MESSAGE_TYPES, enumName: 'TemplatedMessageType' }) messageType!: TemplatedMessageType
  @ApiProperty({ enum: ['tenant', 'property_owner'], enumName: 'TemplateAudience' }) audience!: 'tenant' | 'property_owner'
  @ApiPropertyOptional({ type: MessageTypeTemplateMappingDto, description: 'Absent until a company admin chooses a template' })
  mapping?: MessageTypeTemplateMappingDto
  @ApiProperty({ description: 'Messages of this type can be sent now: a template is chosen, Meta approved it and its text is unchanged' })
  sendable!: boolean
}

export class MessageTemplateSettingsDto implements MessageTemplateSettings {
  @ApiProperty({ description: "At least one of the company's WhatsApp numbers is connected" }) whatsappConnected!: boolean
  @ApiProperty({ type: [MessageTypeTemplateDto], description: 'Every templated message type: the five tenant types, then the owner types' })
  types!: MessageTypeTemplateDto[]
}

/** Body of PUT /message-templates/{messageType}. */
export class ChooseMessageTemplateDto {
  @ApiProperty({ format: 'uuid', description: "A synced Meta template of the company (GET /integrations/whatsapp/message-templates)" })
  whatsappTemplateId!: string
}

assertSchemaMatchesDto<z.infer<typeof chooseMessageTemplateBodySchema>, ChooseMessageTemplateDto>(true)

export class MessageTemplateSyncDto {
  @ApiProperty({ description: 'Connected numbers whose WhatsApp Business Account is synced (one per account)' }) queued!: number
  @ApiProperty() message!: string
}
