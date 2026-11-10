import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  type AuditAction,
  type AuditScalar,
  type EntityType,
  type FieldChange,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto, SORT_DIRECTIONS, type SortDirection } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { AuditLogEntry } from '../audit.mapper'
import { AUDIT_LOG_SORT_FIELDS, type auditLogListQuerySchema } from '../audit.schemas'

export class FieldChangeDto implements FieldChange {
  @ApiProperty() field!: string

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    nullable: true,
    description: 'Value before the change',
  })
  before!: AuditScalar

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    nullable: true,
    description: 'Value after the change',
  })
  after!: AuditScalar
}

/** One audit log entry. The domain `AuditLog`, with `actorUserId` absent for background-job actions. */
export class AuditLogDto implements AuditLogEntry {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Absent for actions taken by background jobs' })
  actorUserId?: string
  @ApiProperty({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' }) action!: AuditAction
  @ApiProperty({ enum: ENTITY_TYPES, enumName: 'EntityType' }) entityType!: EntityType
  @ApiProperty({ format: 'uuid' }) entityId!: string
  @ApiProperty() summary!: string
  @ApiPropertyOptional({ type: [FieldChangeDto] }) changes?: FieldChangeDto[]
  @ApiProperty({ format: 'date-time' }) occurredAt!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time', description: 'Equal to createdAt: entries are never updated' }) updatedAt!: string
}

export const AuditLogPageDto = createPageDto(AuditLogDto, 'AuditLogPage')

export class AuditLogListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AUDIT_LOG_SORT_FIELDS, enumName: 'AuditLogSortField', default: 'occurredAt' })
  sort?: (typeof AUDIT_LOG_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, enumName: 'SortDirection', default: 'desc' })
  override direction: SortDirection = 'desc'

  @ApiPropertyOptional({ enum: ENTITY_TYPES, enumName: 'EntityType' })
  entityType?: EntityType

  @ApiPropertyOptional({ format: 'uuid' })
  entityId?: string

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' })
  action?: AuditAction

  @ApiPropertyOptional({ format: 'uuid' })
  actorUserId?: string

  @ApiPropertyOptional({ format: 'date', description: 'First South African calendar day included' })
  from?: string

  @ApiPropertyOptional({ format: 'date', description: 'Last South African calendar day included' })
  to?: string
}

assertSchemaMatchesDto<z.infer<typeof auditLogListQuerySchema>, AuditLogListQueryDto>(true)
