import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  EVENT_AGE_BUCKETS,
  EVENT_PRIORITIES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type EventAgeBucket,
  type EventPriority,
  type LeaseMonitoringReport,
  type MonitoringEventRow,
  type MonitoringEventStatus,
  type MonitoringEventType,
  type RentalDiscrepancyReport,
  type RentalDiscrepancyRow,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ lease monitoring

export class MonitoringEventReportRowDto implements MonitoringEventRow {
  @ApiProperty({ format: 'uuid' })
  eventId!: string

  @ApiProperty({ enum: MONITORING_EVENT_TYPES, enumName: 'MonitoringEventType' })
  type!: MonitoringEventType

  @ApiProperty()
  title!: string

  @ApiProperty({ enum: EVENT_PRIORITIES, enumName: 'EventPriority' })
  priority!: EventPriority

  @ApiProperty({ enum: MONITORING_EVENT_STATUSES, enumName: 'MonitoringEventStatus' })
  status!: MonitoringEventStatus

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional()
  unitNumber?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional()
  tenantName?: string

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional()
  leaseReference?: string

  @ApiPropertyOptional({ format: 'uuid' })
  statementId?: string

  @ApiProperty({ format: 'date' })
  identifiedOn!: string

  @ApiPropertyOptional({ format: 'date' })
  dueDate?: string

  @ApiProperty({ description: 'Days from the date the event was identified to the "as at" date.' })
  ageDays!: number

  @ApiProperty({ enum: EVENT_AGE_BUCKETS, enumName: 'EventAgeBucket' })
  ageBucket!: EventAgeBucket

  @ApiProperty({ description: 'Still open with a due date before the "as at" date.' })
  overdue!: boolean
}

export class MonitoringEventTypeCountsDto implements Record<MonitoringEventType, number> {
  @ApiProperty()
  rental_escalation_discrepancy!: number

  @ApiProperty()
  lease_expiry!: number

  @ApiProperty()
  renewal_notice_deadline!: number

  @ApiProperty()
  guarantee_expiry!: number

  @ApiProperty()
  guarantee_shortfall!: number

  @ApiProperty()
  deposit_shortfall!: number

  @ApiProperty()
  arrears!: number

  @ApiProperty()
  arrangement_attention!: number

  @ApiProperty()
  statement_review_required!: number
}

export class EventPriorityCountsDto implements Record<EventPriority, number> {
  @ApiProperty()
  low!: number

  @ApiProperty()
  medium!: number

  @ApiProperty()
  high!: number

  @ApiProperty()
  critical!: number
}

export class MonitoringEventStatusCountsDto implements Record<MonitoringEventStatus, number> {
  @ApiProperty()
  new!: number

  @ApiProperty()
  under_review!: number

  @ApiProperty()
  action_required!: number

  @ApiProperty()
  in_progress!: number

  @ApiProperty()
  resolved!: number

  @ApiProperty()
  dismissed!: number
}

export class MonitoringEventsByPropertyDto {
  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiProperty()
  total!: number

  @ApiProperty()
  open!: number

  @ApiProperty()
  overdue!: number
}

export class MonitoringEventsByAgeDto {
  @ApiProperty({ enum: EVENT_AGE_BUCKETS, enumName: 'EventAgeBucket' })
  bucket!: EventAgeBucket

  @ApiProperty()
  count!: number
}

export class LeaseMonitoringReportDto implements LeaseMonitoringReport {
  @ApiProperty({ description: 'Events listed: the open events, or the events of the statuses asked for.' })
  total!: number

  @ApiProperty({ description: 'Listed events still open (new, under review, action required, in progress).' })
  open!: number

  @ApiProperty({ description: 'Listed events still open and past their due date.' })
  overdue!: number

  @ApiProperty({ type: MonitoringEventTypeCountsDto })
  byType!: MonitoringEventTypeCountsDto

  @ApiProperty({ type: EventPriorityCountsDto })
  byPriority!: EventPriorityCountsDto

  @ApiProperty({ type: MonitoringEventStatusCountsDto })
  byStatus!: MonitoringEventStatusCountsDto

  @ApiProperty({ type: [MonitoringEventsByPropertyDto] })
  byProperty!: MonitoringEventsByPropertyDto[]

  @ApiProperty({ type: [MonitoringEventsByAgeDto] })
  byAge!: MonitoringEventsByAgeDto[]

  @ApiProperty({ type: [MonitoringEventReportRowDto], description: 'Oldest first, then critical first.' })
  events!: MonitoringEventReportRowDto[]
}

export class LeaseMonitoringResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['lease_monitoring'] })
  reportId!: 'lease_monitoring'

  @ApiProperty({ type: LeaseMonitoringReportDto })
  data!: LeaseMonitoringReportDto
}

// ------------------------------------------------------------------------------------------ rental discrepancies

export class RentalDiscrepancyRowDto implements RentalDiscrepancyRow {
  @ApiProperty({ enum: ['event', 'recomputed'], description: '`event`: a monitoring event was raised for the statement; `recomputed`: found by recomputation.' })
  source!: 'event' | 'recomputed'

  @ApiProperty({
    description:
      "True: the lease's latest verified statement compared with its verified terms now. False: an open discrepancy event on an earlier statement, with the calculation it recorded.",
  })
  current!: boolean

  @ApiPropertyOptional({ format: 'uuid' })
  eventId?: string

  @ApiPropertyOptional({ enum: MONITORING_EVENT_STATUSES, enumName: 'MonitoringEventStatus' })
  eventStatus?: MonitoringEventStatus

  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty()
  leaseReference!: string

  @ApiProperty({ format: 'uuid' })
  tenantId!: string

  @ApiProperty()
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional()
  unitNumber?: string

  @ApiPropertyOptional({ format: 'uuid' })
  statementId?: string

  @ApiPropertyOptional({ format: 'date' })
  statementDate?: string

  @ApiPropertyOptional({ format: 'date', description: 'Start of the billed period: the date the contractual rental is evaluated at.' })
  periodStart?: string

  @ApiProperty({ description: 'Escalated contractual monthly rental (ZAR).' })
  expected!: number

  @ApiProperty({ description: 'Rental billed on the statement (ZAR).' })
  billed!: number

  @ApiProperty({ description: 'Expected − billed (ZAR); positive = under-billed.' })
  difference!: number

  @ApiProperty()
  withinTolerance!: boolean

  @ApiProperty({ type: [String], description: 'The escalation calculation, step by step.' })
  steps!: string[]
}

export class RentalDiscrepancyReportDto implements RentalDiscrepancyReport {
  @ApiProperty({ type: [RentalDiscrepancyRowDto], description: 'Outside tolerance first, largest difference first.' })
  rows!: RentalDiscrepancyRowDto[]

  @ApiProperty({ description: 'Sum of the differences on rows outside tolerance (ZAR).' })
  totalMonthlyDifference!: number

  @ApiProperty({ description: 'Sum of the positive differences outside tolerance (ZAR).' })
  underBilled!: number

  @ApiProperty({ description: 'Sum of the negative differences outside tolerance, as a positive amount (ZAR).' })
  overBilled!: number

  @ApiProperty()
  outsideToleranceCount!: number

  @ApiProperty({ description: 'Rows with a raised monitoring event.' })
  eventCount!: number

  @ApiProperty({ description: 'Rows outside tolerance with no event raised yet.' })
  recomputedCount!: number

  @ApiProperty({ description: "Open rental escalation discrepancy events at the listed properties (the dashboard's figure without filters)." })
  openEventCount!: number

  @ApiProperty({ description: 'Verified, monitored leases compared with their latest verified statement.' })
  leasesCompared!: number

  @ApiProperty({ description: 'Verified, monitored leases without a verified statement that bills rental yet.' })
  awaitingStatement!: number

  @ApiProperty({ description: 'Leases waiting for verification: their terms drive no monitoring yet.' })
  unverifiedLeasesExcluded!: number
}

export class RentalDiscrepanciesResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['rental_discrepancies'] })
  reportId!: 'rental_discrepancies'

  @ApiProperty({ type: RentalDiscrepancyReportDto })
  data!: RentalDiscrepancyReportDto
}
