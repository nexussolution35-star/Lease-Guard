import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { OCCUPANCY_STATUSES, UNIT_TYPES, type OccupancyStatus, type Unit, type UnitType } from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { UNIT_SORT_FIELDS, type unitListQuerySchema } from '../units.schemas'

/** A lettable unit in the active company. Same shape as the domain `Unit`. */
export class UnitDto implements Unit {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty({ example: 'G12' }) unitNumber!: string
  @ApiProperty({ enum: UNIT_TYPES, enumName: 'UnitType' }) type!: UnitType
  @ApiProperty({ description: 'Floor area in square metres' }) floorAreaSqm!: number
  @ApiPropertyOptional() floor?: string
  @ApiProperty({ enum: OCCUPANCY_STATUSES, enumName: 'OccupancyStatus' }) occupancyStatus!: OccupancyStatus
  @ApiPropertyOptional({ format: 'uuid', description: 'Tenant of the active lease (denormalised)' })
  currentTenantId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Active lease (denormalised)' }) currentLeaseId?: string
  @ApiPropertyOptional() description?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const UnitPageDto = createPageDto(UnitDto, 'UnitPage')

export class UnitListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: UNIT_SORT_FIELDS, enumName: 'UnitSortField' })
  sort?: (typeof UNIT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string

  @ApiPropertyOptional({ enum: OCCUPANCY_STATUSES, enumName: 'OccupancyStatus' })
  occupancyStatus?: OccupancyStatus

  @ApiPropertyOptional({ enum: UNIT_TYPES, enumName: 'UnitType' })
  type?: UnitType
}

assertSchemaMatchesDto<z.infer<typeof unitListQuerySchema>, UnitListQueryDto>(true)
