import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ENTITY_TYPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  type EntityType,
  type Notification,
  type NotificationSeverity,
  type NotificationType,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto, SORT_DIRECTIONS, type SortDirection } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { MarkAllReadResult } from '../notifications.mapper'
import { NOTIFICATION_SORT_FIELDS, type notificationListQuerySchema } from '../notifications.schemas'

export class NotificationLinkDto implements NonNullable<Notification['link']> {
  @ApiProperty({ enum: ENTITY_TYPES, enumName: 'EntityType' }) entityType!: EntityType
  @ApiProperty({ format: 'uuid' }) entityId!: string
}

/** An in-app notification for the caller. Same shape as the domain `Notification`. */
export class NotificationDto implements Notification {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' }) type!: NotificationType
  @ApiProperty({ enum: NOTIFICATION_SEVERITIES, enumName: 'NotificationSeverity' }) severity!: NotificationSeverity
  @ApiProperty() title!: string
  @ApiProperty() body!: string
  @ApiProperty() read!: boolean
  @ApiPropertyOptional({ format: 'date-time' }) readAt?: string
  @ApiPropertyOptional({ type: NotificationLinkDto, description: 'The record the notification is about' })
  link?: NotificationLinkDto
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const NotificationPageDto = createPageDto(NotificationDto, 'NotificationPage')

export class NotificationListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_SORT_FIELDS, enumName: 'NotificationSortField', default: 'createdAt' })
  sort?: (typeof NOTIFICATION_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, enumName: 'SortDirection', default: 'desc' })
  override direction: SortDirection = 'desc'

  @ApiPropertyOptional({ type: Boolean, description: 'Only unread notifications' })
  unreadOnly?: boolean

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' })
  type?: NotificationType

  @ApiPropertyOptional({ enum: NOTIFICATION_SEVERITIES, enumName: 'NotificationSeverity' })
  severity?: NotificationSeverity
}

assertSchemaMatchesDto<z.infer<typeof notificationListQuerySchema>, NotificationListQueryDto>(true)

export class MarkAllReadResultDto implements MarkAllReadResult {
  @ApiProperty({ minimum: 0, description: 'Notifications that changed from unread to read' })
  updated!: number
}
