import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  APPROVAL_AGE_BUCKETS,
  APPROVAL_DECISIONS,
  CHANNELS,
  DELIVERY_OUTCOMES,
  DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  RECIPIENT_TYPES,
  STATEMENT_SOURCES,
  STATEMENT_STATUSES,
  type ApprovalAgeBucket,
  type ApprovalDecision,
  type Channel,
  type CommunicationActivityReport,
  type CommunicationActivityRow,
  type CommunicationGroupFigures,
  type DeliveryOutcome,
  type DeliveryStatus,
  type MessageDirection,
  type MessageType,
  type PendingApprovalRow,
  type RecipientType,
  type StatementGroupFigures,
  type StatementProcessingReport,
  type StatementSource,
  type StatementStatus,
  type StatementUploadRow,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ statement processing

export class StatementUploadRowDto implements StatementUploadRow {
  @ApiProperty({ format: 'uuid' })
  statementId!: string

  @ApiProperty({ example: 'MSQ-2026-10.pdf' })
  fileName!: string

  @ApiPropertyOptional()
  statementNumber?: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional()
  tenantName?: string

  @ApiPropertyOptional({ format: 'uuid' })
  unitId?: string

  @ApiPropertyOptional()
  unitNumber?: string

  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' })
  sourceSystem!: StatementSource

  @ApiProperty({ enum: STATEMENT_STATUSES, enumName: 'StatementStatus' })
  status!: StatementStatus

  @ApiProperty({ format: 'date-time' })
  uploadedAt!: string

  @ApiProperty({ format: 'date', description: 'The South African calendar date of the upload (the date range bounds it).' })
  uploadedOn!: string

  @ApiPropertyOptional({ format: 'date' })
  statementDate?: string

  @ApiProperty({ description: 'Automatic extraction gave up: under review with the reason in processingError.' })
  processingFailed!: boolean

  @ApiPropertyOptional()
  processingError?: string

  @ApiPropertyOptional({ format: 'uuid' })
  duplicateOfStatementId?: string

  @ApiPropertyOptional({ description: 'Overall extraction confidence (0–1).' })
  extractionConfidence?: number

  @ApiProperty({ description: 'Extracted fields a reviewer still has to confirm or correct.' })
  unresolvedFields!: number

  @ApiProperty({ description: 'Whole days from the upload date to the as-at date.' })
  ageDays!: number
}

export class StatementGroupFiguresDto implements StatementGroupFigures {
  @ApiProperty()
  total!: number

  @ApiProperty({ description: 'Uploaded or processing.' })
  inProgress!: number

  @ApiProperty({ description: 'Status review_required, processing failures included (as the dashboard counts).' })
  pendingReview!: number

  @ApiProperty()
  processingFailures!: number

  @ApiProperty()
  verified!: number

  @ApiProperty()
  rejected!: number

  @ApiProperty()
  duplicate!: number
}

export class StatementSourceFiguresDto extends StatementGroupFiguresDto {
  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' })
  sourceSystem!: StatementSource
}

export class StatementPropertyFiguresDto extends StatementGroupFiguresDto {
  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string
}

export class StatementStatusCountsDto implements Record<StatementStatus, number> {
  @ApiProperty()
  uploaded!: number

  @ApiProperty()
  processing!: number

  @ApiProperty()
  review_required!: number

  @ApiProperty()
  verified!: number

  @ApiProperty()
  rejected!: number

  @ApiProperty()
  duplicate!: number
}

export class StatementProcessingReportDto extends StatementGroupFiguresDto implements StatementProcessingReport {
  @ApiProperty({ type: StatementStatusCountsDto })
  countsByStatus!: StatementStatusCountsDto

  @ApiProperty({ type: [StatementSourceFiguresDto], description: 'In source order; sources without uploads left out.' })
  bySource!: StatementSourceFiguresDto[]

  @ApiProperty({ type: [StatementPropertyFiguresDto], description: 'By property name.' })
  byProperty!: StatementPropertyFiguresDto[]

  @ApiProperty({ description: 'Under review with nothing failed.' })
  awaitingReview!: number

  @ApiProperty({ type: Number, nullable: true, description: 'Age in days of the oldest statement waiting for review.' })
  oldestPendingReviewDays!: number | null

  @ApiProperty({ type: Number, nullable: true, description: 'Mean overall extraction confidence (0–1).' })
  averageExtractionConfidence!: number | null

  @ApiProperty({ type: [StatementUploadRowDto], description: 'Waiting for review, processing failures included, oldest upload first.' })
  backlog!: StatementUploadRowDto[]

  @ApiProperty({ type: [StatementUploadRowDto], description: 'Automatic processing failed, oldest upload first.' })
  failures!: StatementUploadRowDto[]

  @ApiProperty({ type: [StatementUploadRowDto], description: 'Every upload shown, newest first.' })
  rows!: StatementUploadRowDto[]
}

export class StatementProcessingResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['statement_processing'] })
  reportId!: 'statement_processing'

  @ApiProperty({ type: StatementProcessingReportDto })
  data!: StatementProcessingReportDto
}

// ------------------------------------------------------------------------------------------ communication activity

/** A message's fields, without when its approval was requested (optional on a message, required while pending). */
abstract class CommunicationActivityRowBaseDto implements Omit<CommunicationActivityRow, 'approvalRequestedAt'> {
  @ApiProperty({ format: 'uuid' })
  communicationId!: string

  @ApiProperty({ format: 'date-time' })
  createdAt!: string

  @ApiProperty({ format: 'date', description: 'The South African calendar date the message was recorded (the date range bounds it).' })
  createdOn!: string

  @ApiProperty({ enum: CHANNELS, enumName: 'Channel' })
  channel!: Channel

  @ApiProperty({ enum: MESSAGE_DIRECTIONS, enumName: 'MessageDirection' })
  direction!: MessageDirection

  @ApiProperty({ enum: MESSAGE_TYPES, enumName: 'MessageType' })
  messageType!: MessageType

  @ApiProperty({ enum: RECIPIENT_TYPES, enumName: 'RecipientType' })
  recipientType!: RecipientType

  @ApiPropertyOptional({ description: "The tenant's trading name, the owner's name or the contact's WhatsApp name." })
  counterpartyName?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional({ format: 'uuid', description: "The message's property, else its lease's, statement's or arrangement's." })
  propertyId?: string

  @ApiPropertyOptional()
  propertyName?: string

  @ApiPropertyOptional({ format: 'uuid' })
  statementId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  arrangementId?: string

  @ApiProperty({ enum: DELIVERY_STATUSES, enumName: 'DeliveryStatus' })
  status!: DeliveryStatus

  @ApiPropertyOptional({ enum: DELIVERY_OUTCOMES, enumName: 'DeliveryOutcome', description: 'Outbound messages handed over for sending only.' })
  outcome?: DeliveryOutcome

  @ApiPropertyOptional()
  failureReason?: string

  @ApiPropertyOptional({ enum: APPROVAL_DECISIONS, enumName: 'ApprovalDecision', description: 'The pending request, else the latest decided one.' })
  approvalDecision?: ApprovalDecision

  @ApiPropertyOptional({ format: 'date-time' })
  approvalDecidedAt?: string
}

export class CommunicationActivityRowDto extends CommunicationActivityRowBaseDto implements CommunicationActivityRow {
  @ApiPropertyOptional({ format: 'date-time' })
  approvalRequestedAt?: string
}

export class PendingApprovalRowDto extends CommunicationActivityRowBaseDto implements PendingApprovalRow {
  @ApiProperty({ format: 'date-time' })
  approvalRequestedAt!: string

  @ApiProperty({ description: 'Whole hours the request has waited.' })
  waitingHours!: number

  @ApiProperty({ enum: APPROVAL_AGE_BUCKETS, enumName: 'ApprovalAgeBucket' })
  ageBucket!: ApprovalAgeBucket
}

export class CommunicationGroupFiguresDto implements CommunicationGroupFigures {
  @ApiProperty()
  total!: number

  @ApiProperty()
  outbound!: number

  @ApiProperty()
  inbound!: number

  @ApiProperty({ description: 'Outbound messages handed to WhatsApp for sending (queued, sent, delivered, read or failed).' })
  handedOver!: number

  @ApiProperty({ description: 'Delivered, read included.' })
  delivered!: number

  @ApiProperty()
  failed!: number

  @ApiProperty()
  pendingApproval!: number
}

export class CommunicationTypeFiguresDto extends CommunicationGroupFiguresDto {
  @ApiProperty({ enum: MESSAGE_TYPES, enumName: 'MessageType' })
  messageType!: MessageType
}

export class CommunicationPropertyFiguresDto extends CommunicationGroupFiguresDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null for messages without a property.' })
  propertyId!: string | null

  @ApiProperty({ type: String, nullable: true })
  propertyName!: string | null
}

export class DeliveryStatusCountsDto implements Record<DeliveryStatus, number> {
  @ApiProperty()
  draft!: number

  @ApiProperty()
  pending_approval!: number

  @ApiProperty()
  approved!: number

  @ApiProperty()
  queued!: number

  @ApiProperty()
  sent!: number

  @ApiProperty()
  delivered!: number

  @ApiProperty()
  read!: number

  @ApiProperty()
  failed!: number

  @ApiProperty()
  rejected!: number

  @ApiProperty()
  received!: number
}

export class DeliveryOutcomeCountsDto implements Record<DeliveryOutcome, number> {
  @ApiProperty({ description: 'Queued or sent, not delivered yet.' })
  pending!: number

  @ApiProperty()
  delivered!: number

  @ApiProperty()
  read!: number

  @ApiProperty()
  failed!: number
}

export class ApprovalAgeCountDto {
  @ApiProperty({ enum: APPROVAL_AGE_BUCKETS, enumName: 'ApprovalAgeBucket' })
  bucket!: ApprovalAgeBucket

  @ApiProperty()
  count!: number
}

export class ApprovalFiguresDto {
  @ApiProperty()
  pending!: number

  @ApiProperty()
  approved!: number

  @ApiProperty()
  rejected!: number

  @ApiProperty({ type: Number, nullable: true, description: "Mean minutes from request to a person's decision." })
  averageTurnaroundMinutes!: number | null

  @ApiProperty({ type: Number, nullable: true, description: 'Hours the oldest pending request has waited.' })
  oldestPendingHours!: number | null

  @ApiProperty({ type: [ApprovalAgeCountDto] })
  byAge!: ApprovalAgeCountDto[]
}

export class CommunicationActivityReportDto extends CommunicationGroupFiguresDto implements CommunicationActivityReport {
  @ApiProperty({ type: [CommunicationTypeFiguresDto], description: 'In message type order; types without messages left out.' })
  byType!: CommunicationTypeFiguresDto[]

  @ApiProperty({ type: DeliveryStatusCountsDto })
  byStatus!: DeliveryStatusCountsDto

  @ApiProperty({ type: [CommunicationPropertyFiguresDto], description: 'By property name; messages without a property last.' })
  byProperty!: CommunicationPropertyFiguresDto[]

  @ApiProperty({ type: DeliveryOutcomeCountsDto })
  outcomes!: DeliveryOutcomeCountsDto

  @ApiProperty({ type: Number, nullable: true, description: 'Delivered (read included) over handed over (0–1).' })
  deliveryRate!: number | null

  @ApiProperty({ type: ApprovalFiguresDto })
  approvals!: ApprovalFiguresDto

  @ApiProperty({ type: [PendingApprovalRowDto], description: 'Longest waiting first.' })
  pendingApprovals!: PendingApprovalRowDto[]

  @ApiProperty({ type: [CommunicationActivityRowDto], description: 'Outbound messages that failed, newest first.' })
  failedMessages!: CommunicationActivityRowDto[]

  @ApiProperty({ type: [CommunicationActivityRowDto], description: 'Every message shown, newest first.' })
  rows!: CommunicationActivityRowDto[]
}

export class CommunicationActivityResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['communication_activity'] })
  reportId!: 'communication_activity'

  @ApiProperty({ type: CommunicationActivityReportDto })
  data!: CommunicationActivityReportDto
}
