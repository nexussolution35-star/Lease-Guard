import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  DELIVERY_STATUSES,
  EVENT_PRIORITIES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  OWNER_ATTENTION_KINDS,
  OWNER_SUMMARY_STATUSES,
  WEEKDAYS,
  type DeliveryStatus,
  type EventPriority,
  type MonitoringEventStatus,
  type MonitoringEventType,
  type OwnerAttentionKind,
  type OwnerSummaryAttentionItem,
  type OwnerSummaryDelivery,
  type OwnerSummaryDiscrepancy,
  type OwnerSummaryEvent,
  type OwnerSummaryGuarantee,
  type OwnerSummaryStatus,
  type OwnerWeeklySummary,
  type OwnerWeeklySummaryPreview,
  type OwnerWeeklySummaryReport,
  type Weekday,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

export class OwnerSummaryPropertyDto {
  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty({ example: 'Maponya Square' })
  propertyName!: string
}

export class OwnerSummaryPreviousDto {
  @ApiProperty({ format: 'date' })
  weekStart!: string

  @ApiProperty({ description: 'ZAR' })
  totalOutstanding!: number
}

export class OwnerSummaryEventDto implements OwnerSummaryEvent {
  @ApiProperty({ format: 'uuid' })
  eventId!: string

  @ApiProperty({ enum: MONITORING_EVENT_TYPES })
  type!: MonitoringEventType

  @ApiProperty()
  title!: string

  @ApiProperty({ enum: EVENT_PRIORITIES })
  priority!: EventPriority

  @ApiProperty({ enum: MONITORING_EVENT_STATUSES })
  status!: MonitoringEventStatus

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiProperty({ format: 'date' })
  identifiedOn!: string

  @ApiPropertyOptional({ format: 'date' })
  dueDate?: string

  @ApiProperty()
  overdue!: boolean
}

export class OwnerSummaryDiscrepancyDto implements OwnerSummaryDiscrepancy {
  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty()
  leaseReference!: string

  @ApiProperty()
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiProperty({ description: 'Escalated contractual rental (ZAR).' })
  expected!: number

  @ApiProperty({ description: 'Rental billed on the latest verified statement (ZAR).' })
  billed!: number

  @ApiProperty({ description: 'expected − billed (ZAR); positive = under-billed.' })
  difference!: number
}

export class OwnerSummaryGuaranteeDto implements OwnerSummaryGuarantee {
  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty()
  reference!: string

  @ApiProperty()
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional()
  guaranteeBank?: string

  @ApiPropertyOptional({ description: 'ZAR' })
  guaranteeAmount?: number

  @ApiProperty({ format: 'date' })
  expiresOn!: string

  @ApiProperty()
  daysUntilExpiry!: number
}

export class OwnerSummaryRecordDto {
  @ApiProperty({ enum: ['monitoring_event', 'payment_arrangement', 'lease'] })
  entity!: 'monitoring_event' | 'payment_arrangement' | 'lease'

  @ApiProperty({ format: 'uuid' })
  id!: string
}

export class OwnerSummaryAttentionItemDto implements OwnerSummaryAttentionItem {
  @ApiProperty({ enum: OWNER_ATTENTION_KINDS })
  kind!: OwnerAttentionKind

  @ApiProperty()
  title!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiProperty({ type: OwnerSummaryRecordDto })
  record!: OwnerSummaryRecordDto
}

export class OwnerWeeklySummaryDto implements OwnerWeeklySummary {
  @ApiProperty({ format: 'uuid' })
  ownerUserId!: string

  @ApiProperty()
  ownerName!: string

  @ApiProperty({ format: 'date', description: 'Monday of the week.' })
  weekStart!: string

  @ApiProperty({ format: 'date' })
  asOf!: string

  @ApiProperty({ type: [OwnerSummaryPropertyDto] })
  properties!: OwnerSummaryPropertyDto[]

  @ApiProperty({ description: 'Outstanding on the latest verified statements at the owner\'s properties (ZAR).' })
  totalOutstanding!: number

  @ApiProperty()
  tenantsInArrears!: number

  @ApiProperty({ description: 'ZAR' })
  outstandingUnderArrangement!: number

  @ApiProperty({ type: OwnerSummaryPreviousDto, nullable: true, description: 'The owner\'s previous stored summary; null for the first.' })
  previous!: OwnerSummaryPreviousDto | null

  @ApiProperty({ type: Number, nullable: true, description: 'Change in the outstanding total since the previous summary (ZAR).' })
  outstandingChange!: number | null

  @ApiProperty()
  openEventCount!: number

  @ApiProperty({ type: [OwnerSummaryEventDto] })
  importantEvents!: OwnerSummaryEventDto[]

  @ApiProperty({ type: [OwnerSummaryDiscrepancyDto] })
  discrepancies!: OwnerSummaryDiscrepancyDto[]

  @ApiProperty({ description: 'ZAR' })
  discrepancyMonthlyDifference!: number

  @ApiProperty({ type: [OwnerSummaryGuaranteeDto] })
  expiringGuarantees!: OwnerSummaryGuaranteeDto[]

  @ApiProperty({ type: [OwnerSummaryAttentionItemDto] })
  attention!: OwnerSummaryAttentionItemDto[]
}

export class OwnerSummaryDeliveryDto implements OwnerSummaryDelivery {
  @ApiProperty({ format: 'uuid' })
  summaryId!: string

  @ApiProperty({ enum: OWNER_SUMMARY_STATUSES })
  status!: OwnerSummaryStatus

  @ApiProperty({ format: 'date-time' })
  computedAt!: string

  @ApiProperty({ type: [String] })
  blockers!: string[]

  @ApiPropertyOptional({ format: 'uuid', description: 'The owner_weekly_summary communication (message history).' })
  communicationId?: string

  @ApiPropertyOptional({ enum: DELIVERY_STATUSES })
  deliveryStatus?: DeliveryStatus

  @ApiPropertyOptional()
  failureReason?: string

  @ApiPropertyOptional({ format: 'date-time' })
  sentAt?: string
}

export class OwnerWeeklySummaryPreviewDto implements OwnerWeeklySummaryPreview {
  @ApiProperty({ type: OwnerWeeklySummaryDto })
  summary!: OwnerWeeklySummaryDto

  @ApiProperty({ type: [String], description: '{{1}} owner name, {{2}} week, {{3}} the summary in one line.' })
  values!: string[]

  @ApiPropertyOptional({ description: 'The WhatsApp text: the chosen template filled in.' })
  message?: string

  @ApiProperty({ type: [String], description: 'Why it would not be sent now; empty when it would.' })
  blockers!: string[]

  @ApiPropertyOptional({ type: OwnerSummaryDeliveryDto })
  delivery?: OwnerSummaryDeliveryDto
}

export class OwnerSummaryTemplateDto {
  @ApiProperty()
  metaTemplateName!: string

  @ApiProperty({ example: 'en_ZA' })
  language!: string

  @ApiProperty()
  sendable!: boolean

  @ApiProperty()
  summary!: string
}

export class OwnerWeeklySummaryReportDto implements OwnerWeeklySummaryReport {
  @ApiProperty({ format: 'date' })
  weekStart!: string

  @ApiProperty({ enum: WEEKDAYS })
  sendWeekday!: Weekday

  @ApiProperty({ format: 'date' })
  nextSendOn!: string

  @ApiProperty({ type: [String], description: 'Why the company sends no owner summary now (template, number).' })
  blockers!: string[]

  @ApiPropertyOptional({ type: OwnerSummaryTemplateDto })
  template?: OwnerSummaryTemplateDto

  @ApiProperty({ type: [OwnerWeeklySummaryPreviewDto] })
  owners!: OwnerWeeklySummaryPreviewDto[]
}

export class OwnerWeeklySummaryResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['owner_weekly_summary'] })
  reportId!: 'owner_weekly_summary'

  @ApiProperty({ type: OwnerWeeklySummaryReportDto })
  data!: OwnerWeeklySummaryReportDto
}
