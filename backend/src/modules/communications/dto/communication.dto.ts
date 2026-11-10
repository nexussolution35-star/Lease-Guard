import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  APPROVAL_DECISIONS,
  CHANNELS,
  DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  RECIPIENT_TYPES,
  type ApprovalDecision,
  type Channel,
  type Communication,
  type DeliveryStatus,
  type MessageApproval,
  type MessageDirection,
  type MessageType,
  type RecipientType,
  type StoredFile,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto, SORT_DIRECTIONS, type SortDirection } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { ApprovalDecisionResult, PendingApproval } from '../communications.mapper'
import {
  APPROVAL_QUEUE_SORT_FIELDS,
  COMMUNICATION_SORT_FIELDS,
  type approvalQueueQuerySchema,
  type approveCommunicationBodySchema,
  type communicationListQuerySchema,
  type rejectCommunicationBodySchema,
} from '../communications.schemas'

const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const

export class StoredFileDto implements StoredFile {
  @ApiProperty() fileName!: string
  @ApiProperty() storagePath!: string
  @ApiProperty({ enum: ATTACHMENT_MIME_TYPES, enumName: 'StoredFileMimeType' }) mimeType!: StoredFile['mimeType']
  @ApiProperty({ minimum: 1 }) sizeBytes!: number
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: 'SHA-256 hex digest' }) sha256!: string
}

/** One WhatsApp message (outbound or inbound) in the active company. Same shape as the domain `Communication`. */
export class CommunicationDto implements Communication {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: CHANNELS, enumName: 'Channel' }) channel!: Channel
  @ApiProperty({ enum: MESSAGE_DIRECTIONS, enumName: 'MessageDirection' }) direction!: MessageDirection
  @ApiProperty({ enum: MESSAGE_TYPES, enumName: 'MessageType' }) messageType!: MessageType
  @ApiProperty({ enum: RECIPIENT_TYPES, enumName: 'RecipientType' }) recipientType!: RecipientType
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Property owner user, for owner messages' }) ownerUserId?: string
  @ApiPropertyOptional({ format: 'uuid' }) propertyId?: string
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string
  @ApiPropertyOptional({ format: 'uuid' }) statementId?: string
  @ApiPropertyOptional({ format: 'uuid' }) arrangementId?: string
  @ApiPropertyOptional({ format: 'uuid' }) templateId?: string
  @ApiPropertyOptional({
    description: 'Counterparty WhatsApp number (tenant, owner or contact). Absent on an inbound message whose sender WhatsApp identified by a business-scoped user id only',
  })
  counterpartyNumber?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'The WhatsApp contact of an inbound message' }) contactId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'The WhatsApp conversation the message belongs to' }) conversationId?: string
  @ApiPropertyOptional({ format: 'date-time', description: 'When the sender sent an inbound message' }) receivedAt?: string
  @ApiProperty({ description: "The company's own WhatsApp Business number" }) companyNumber!: string
  @ApiProperty() body!: string
  @ApiPropertyOptional({ type: StoredFileDto }) attachment?: StoredFileDto
  @ApiProperty({ enum: DELIVERY_STATUSES, enumName: 'DeliveryStatus' }) status!: DeliveryStatus
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The approval request governing this message: the open one, otherwise the most recent',
  })
  approvalId?: string
  @ApiPropertyOptional() externalMessageId?: string
  @ApiPropertyOptional({ format: 'uuid' }) createdByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) sentAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) deliveredAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) readAt?: string
  @ApiPropertyOptional() failureReason?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const CommunicationPageDto = createPageDto(CommunicationDto, 'CommunicationPage')

export class CommunicationListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: COMMUNICATION_SORT_FIELDS, enumName: 'CommunicationSortField', default: 'createdAt' })
  sort?: (typeof COMMUNICATION_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, enumName: 'SortDirection', default: 'desc' })
  override direction: SortDirection = 'desc'

  @ApiPropertyOptional({ enum: DELIVERY_STATUSES, enumName: 'DeliveryStatus' })
  status?: DeliveryStatus

  @ApiPropertyOptional({ enum: MESSAGE_TYPES, enumName: 'MessageType' })
  messageType?: MessageType

  @ApiPropertyOptional({ enum: RECIPIENT_TYPES, enumName: 'RecipientType' })
  recipientType?: RecipientType

  @ApiPropertyOptional({ enum: CHANNELS, enumName: 'Channel' })
  channel?: Channel

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string
}

assertSchemaMatchesDto<z.infer<typeof communicationListQuerySchema>, CommunicationListQueryDto>(true)

/** An approval request for one outbound message. Same shape as the domain `MessageApproval`. */
export class MessageApprovalDto implements MessageApproval {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) communicationId!: string
  @ApiProperty({ format: 'uuid' }) requestedByUserId!: string
  @ApiProperty({ format: 'date-time' }) requestedAt!: string
  @ApiProperty({ enum: APPROVAL_DECISIONS, enumName: 'ApprovalDecision' }) decision!: ApprovalDecision
  @ApiPropertyOptional({ format: 'uuid' }) decidedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) decidedAt?: string
  @ApiPropertyOptional({ description: 'Note recorded with the decision; always present for a rejection' }) reason?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export class PendingApprovalDto implements PendingApproval {
  @ApiProperty({ type: MessageApprovalDto }) approval!: MessageApprovalDto
  @ApiProperty({ type: CommunicationDto }) communication!: CommunicationDto
}

export const PendingApprovalPageDto = createPageDto(PendingApprovalDto, 'PendingApprovalPage')

export class ApprovalQueueQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  page!: number

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  pageSize!: number

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, enumName: 'SortDirection', default: 'asc' })
  direction!: SortDirection

  @ApiPropertyOptional({ enum: APPROVAL_QUEUE_SORT_FIELDS, enumName: 'ApprovalQueueSortField', default: 'requestedAt' })
  sort?: (typeof APPROVAL_QUEUE_SORT_FIELDS)[number]
}

assertSchemaMatchesDto<z.infer<typeof approvalQueueQuerySchema>, ApprovalQueueQueryDto>(true)

export class ApproveCommunicationBodyDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Optional note kept with the approval' })
  note?: string
}

assertSchemaMatchesDto<z.infer<typeof approveCommunicationBodySchema>, ApproveCommunicationBodyDto>(true)

export class RejectCommunicationBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 1000, description: 'Why the message is rejected (required)' })
  note!: string
}

assertSchemaMatchesDto<z.infer<typeof rejectCommunicationBodySchema>, RejectCommunicationBodyDto>(true)

export class ApprovalDecisionResultDto implements ApprovalDecisionResult {
  @ApiProperty({ type: MessageApprovalDto }) approval!: MessageApprovalDto
  @ApiProperty({ type: CommunicationDto }) communication!: CommunicationDto
}
