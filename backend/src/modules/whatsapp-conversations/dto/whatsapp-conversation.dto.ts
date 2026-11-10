import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  HANDOVER_REQUESTERS,
  HANDOVER_STATUSES,
  type HandoverRequester,
  type HandoverStatus,
  type WhatsAppConversation,
  type WhatsAppConversationContact,
  type WhatsAppConversationSummary,
  type WhatsAppHandover,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { CommunicationDto } from '../../communications/dto/communication.dto'
import {
  type assignHandoverBodySchema,
  CONVERSATION_FILTERS,
  type ConversationFilter,
  type conversationListQuerySchema,
  type replyBodySchema,
  type resolveHandoverBodySchema,
} from '../whatsapp-conversations.schemas'

export class WhatsAppConversationContactDto implements WhatsAppConversationContact {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiPropertyOptional({ description: "The sender's WhatsApp profile name, when Meta sent one" }) profileName?: string
  @ApiPropertyOptional({ description: 'E.164 number, when Meta sent it (it may identify the sender by a business-scoped user id only)' })
  phoneNumber?: string
  @ApiPropertyOptional({ format: 'uuid', description: "A tenant of the company whose WhatsApp number is the contact's number" }) tenantId?: string
  @ApiPropertyOptional() tenantName?: string
}

/** A request for a person to take over a conversation. Same shape as the domain `WhatsAppHandover`. */
export class WhatsAppHandoverDto implements WhatsAppHandover {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) conversationId!: string
  @ApiProperty({
    enum: HANDOVER_STATUSES,
    enumName: 'HandoverStatus',
    description: 'open: waiting for a person (possibly assigned, not yet accepted); accepted: a person has taken it over; resolved: done',
  })
  status!: HandoverStatus
  @ApiProperty({ description: 'Why a person is needed' }) reason!: string
  @ApiProperty({ enum: HANDOVER_REQUESTERS, enumName: 'HandoverRequester', description: "agent: the company's AI agent; member: a member of staff" })
  requestedBy!: HandoverRequester
  @ApiPropertyOptional({ format: 'uuid' }) requestedByUserId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'The member who handles it' }) assignedUserId?: string
  @ApiPropertyOptional() assignedUserName?: string
  @ApiPropertyOptional({ format: 'date-time' }) acceptedAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) resolvedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) resolvedByUserId?: string
  @ApiPropertyOptional() resolutionNote?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** One WhatsApp thread of the active company. Same shape as the domain `WhatsAppConversationSummary`. */
export class WhatsAppConversationSummaryDto implements WhatsAppConversationSummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid', description: "The company's receiving number" }) numberId!: string
  @ApiProperty({ description: 'The receiving number as displayed' }) companyNumber!: string
  @ApiProperty({ type: WhatsAppConversationContactDto }) contact!: WhatsAppConversationContactDto
  @ApiPropertyOptional({ format: 'date-time', description: "The contact's last message (starts WhatsApp's 24-hour window)" }) lastInboundAt?: string
  @ApiProperty({ format: 'date-time' }) lastMessageAt!: string
  @ApiPropertyOptional({ description: "The latest message's text, shortened" }) lastMessagePreview?: string
  @ApiPropertyOptional({ type: WhatsAppHandoverDto, description: "The conversation's unresolved handover, if any" }) handover?: WhatsAppHandoverDto
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** A conversation with its latest messages (up to 200), oldest first. */
export class WhatsAppConversationDto extends WhatsAppConversationSummaryDto implements WhatsAppConversation {
  @ApiProperty({ type: [CommunicationDto] }) messages!: CommunicationDto[]
}

export const WhatsAppConversationPageDto = createPageDto(WhatsAppConversationSummaryDto, 'WhatsAppConversationPage')

export class WhatsAppConversationListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) page!: number
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) pageSize!: number
  @ApiPropertyOptional({ format: 'uuid', description: 'Only conversations with this receiving number' }) numberId?: string
  @ApiPropertyOptional({
    enum: CONVERSATION_FILTERS,
    enumName: 'ConversationFilter',
    description: 'handed_over: only conversations with an unresolved handover; mine: only those assigned to the caller',
  })
  filter?: ConversationFilter
}

assertSchemaMatchesDto<z.infer<typeof conversationListQuerySchema>, WhatsAppConversationListQueryDto>(true)

export class AssignHandoverBodyDto {
  @ApiProperty({ format: 'uuid', description: 'An active company admin or property manager of the company' }) userId!: string
}
assertSchemaMatchesDto<z.infer<typeof assignHandoverBodySchema>, AssignHandoverBodyDto>(true)

export class ResolveHandoverBodyDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'What was done' }) note?: string
}
assertSchemaMatchesDto<z.infer<typeof resolveHandoverBodySchema>, ResolveHandoverBodyDto>(true)

export class ReplyBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 4096, description: 'Free text; no banking details' }) body!: string
}
assertSchemaMatchesDto<z.infer<typeof replyBodySchema>, ReplyBodyDto>(true)
