import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { WhatsAppConversation, WhatsAppConversationContact, WhatsAppConversationSummary } from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { CommunicationDto } from '../../communications/dto/communication.dto'
import type { conversationListQuerySchema } from '../whatsapp-conversations.schemas'

export class WhatsAppConversationContactDto implements WhatsAppConversationContact {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiPropertyOptional({ description: "The sender's WhatsApp profile name, when Meta sent one" }) profileName?: string
  @ApiPropertyOptional({ description: 'E.164 number, when Meta sent it (it may identify the sender by a business-scoped user id only)' })
  phoneNumber?: string
  @ApiPropertyOptional({ format: 'uuid', description: "A tenant of the company whose WhatsApp number is the contact's number" }) tenantId?: string
  @ApiPropertyOptional() tenantName?: string
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
}

assertSchemaMatchesDto<z.infer<typeof conversationListQuerySchema>, WhatsAppConversationListQueryDto>(true)
