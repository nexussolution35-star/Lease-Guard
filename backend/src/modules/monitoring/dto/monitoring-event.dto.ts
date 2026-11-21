import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  EVENT_PRIORITIES,
  MONITORING_DUE_WINDOWS,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type EventCalculation,
  type EventDismissal,
  type EventPriority,
  type MonitoringDueWindow,
  type MonitoringEvent,
  type MonitoringEventListItem,
  type MonitoringEventStatus,
  type MonitoringEventType,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  MONITORING_EVENT_SORT_FIELDS,
  MONITORING_EVENT_TARGET_STATUSES,
  type monitoringEventListQuerySchema,
  type updateMonitoringEventStatusBodySchema,
} from '../monitoring.schemas'

export class EventCalculationDto implements EventCalculation {
  @ApiPropertyOptional({ description: 'Rands (ZAR)' }) expectedAmount?: number
  @ApiPropertyOptional({ description: 'Rands (ZAR)' }) actualAmount?: number
  @ApiPropertyOptional({ description: 'Rands (ZAR)' }) difference?: number
  @ApiProperty({ type: [String], description: 'How the figures were calculated, step by step' }) steps!: string[]
}

export class EventDismissalDto implements EventDismissal {
  @ApiProperty() reason!: string
  @ApiProperty({ format: 'uuid' }) dismissedByUserId!: string
  @ApiProperty({ format: 'date-time' }) dismissedAt!: string
}

/** A monitoring event in the active company. Same shape as the domain `MonitoringEvent`. */
export class MonitoringEventDto implements MonitoringEvent {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: MONITORING_EVENT_TYPES, enumName: 'MonitoringEventType' }) type!: MonitoringEventType
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string
  @ApiPropertyOptional() leaseReference?: string
  @ApiPropertyOptional({ format: 'uuid' }) statementId?: string
  @ApiPropertyOptional({ format: 'uuid' }) arrangementId?: string
  @ApiPropertyOptional({ format: 'uuid' }) ruleId?: string
  @ApiProperty() title!: string
  @ApiProperty() description!: string
  @ApiPropertyOptional({ type: EventCalculationDto }) calculation?: EventCalculationDto
  @ApiProperty({ format: 'date' }) identifiedOn!: string
  @ApiPropertyOptional({ format: 'date' }) dueDate?: string
  @ApiProperty({ enum: EVENT_PRIORITIES, enumName: 'EventPriority' }) priority!: EventPriority
  @ApiProperty() recommendedAction!: string
  @ApiPropertyOptional({ format: 'uuid' }) assignedToUserId?: string
  @ApiProperty({ enum: MONITORING_EVENT_STATUSES, enumName: 'MonitoringEventStatus' }) status!: MonitoringEventStatus
  @ApiPropertyOptional({ format: 'date-time' }) resolvedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) resolvedByUserId?: string
  @ApiPropertyOptional() resolutionNotes?: string
  @ApiPropertyOptional({ type: EventDismissalDto }) dismissal?: EventDismissalDto
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** A monitoring event as the list shows it: the event plus the names of its property, unit, tenant and assignee. */
export class MonitoringEventListItemDto extends MonitoringEventDto implements MonitoringEventListItem {
  @ApiProperty() propertyName!: string
  @ApiPropertyOptional({ description: 'Absent when the event names no unit' }) unitNumber?: string
  @ApiPropertyOptional({ description: "The tenant's trading name; absent when the event names no tenant" }) tenantName?: string
  @ApiPropertyOptional({ description: "The assigned member's full name; absent when nobody is assigned" }) assigneeName?: string
}

export const MonitoringEventPageDto = createPageDto(MonitoringEventListItemDto, 'MonitoringEventPage')

export class MonitoringEventListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: MONITORING_EVENT_SORT_FIELDS, enumName: 'MonitoringEventSortField' })
  sort?: (typeof MONITORING_EVENT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: MONITORING_EVENT_STATUSES, enumName: 'MonitoringEventStatus' })
  status?: MonitoringEventStatus

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: events that still need attention (new, under review, action required, in progress); false: resolved or dismissed',
  })
  open?: boolean

  @ApiPropertyOptional({ enum: EVENT_PRIORITIES, enumName: 'EventPriority' })
  priority?: EventPriority

  @ApiPropertyOptional({ enum: MONITORING_EVENT_TYPES, enumName: 'MonitoringEventType' })
  type?: MonitoringEventType

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  unitId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional({
    description: "One member's user id (uuid), or `unassigned` for events nobody is assigned to",
    example: 'unassigned',
  })
  assignee?: string

  @ApiPropertyOptional({
    enum: MONITORING_DUE_WINDOWS,
    enumName: 'MonitoringDueWindow',
    description: 'overdue: due before today; next_n_days: due from today to n days from today, inclusive (South African date)',
  })
  due?: MonitoringDueWindow
}

assertSchemaMatchesDto<z.infer<typeof monitoringEventListQuerySchema>, MonitoringEventListQueryDto>(true)

export class UpdateMonitoringEventStatusDto {
  @ApiProperty({ enum: MONITORING_EVENT_TARGET_STATUSES, enumName: 'MonitoringEventTargetStatus' })
  status!: (typeof MONITORING_EVENT_TARGET_STATUSES)[number]

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 2000,
    description: 'Required when dismissing (the dismissal reason); otherwise stored as resolution notes',
  })
  note?: string
}

assertSchemaMatchesDto<z.infer<typeof updateMonitoringEventStatusBodySchema>, UpdateMonitoringEventStatusDto>(true)
