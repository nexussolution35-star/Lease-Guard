import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  OCCUPANCY_STATUSES,
  UNIT_TYPES,
  type OccupancyStatus,
  type Unit,
  type UnitAssignmentSummary,
  type UnitLeaseSummary,
  type UnitListItem,
  type UnitPropertySummary,
  type UnitTenantSummary,
  type UnitType,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { UNIT_SORT_FIELDS, type createUnitBodySchema, type unitListQuerySchema, type updateUnitBodySchema } from '../units.schemas'

/** A unit's current assignment: the tenant holding it without a lease, and since when. */
export class UnitAssignmentSummaryDto implements UnitAssignmentSummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty() tenantName!: string
  @ApiProperty({ format: 'date-time' }) assignedAt!: string
}

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
  @ApiPropertyOptional({ format: 'uuid', description: "Current tenant: the current lease's tenant, else the assigned tenant (derived)" })
  currentTenantId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Active lease (denormalised)' }) currentLeaseId?: string
  @ApiPropertyOptional({ type: UnitAssignmentSummaryDto, description: 'The tenant assigned to the unit without a lease, while assigned' })
  currentAssignment?: UnitAssignmentSummaryDto
  @ApiPropertyOptional() description?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export class UnitPropertySummaryDto implements UnitPropertySummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty({ example: 'MSQ' }) code!: string
}

export class UnitTenantSummaryDto implements UnitTenantSummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() tradingName!: string
}

export class UnitLeaseSummaryDto implements UnitLeaseSummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() reference!: string
  @ApiProperty({ format: 'date' }) commencementDate!: string
  @ApiProperty({ format: 'date' }) expiryDate!: string
}

/** A listed unit: the unit with its property and, when let, the tenant and lease of its active lease. */
export class UnitListItemDto extends UnitDto implements UnitListItem {
  @ApiProperty({ type: UnitPropertySummaryDto }) property!: UnitPropertySummaryDto
  @ApiPropertyOptional({ type: UnitTenantSummaryDto, description: "Current tenant: the current lease's tenant, else the assigned tenant" })
  currentTenant?: UnitTenantSummaryDto
  @ApiPropertyOptional({ type: UnitLeaseSummaryDto, description: 'The active lease' })
  currentLease?: UnitLeaseSummaryDto
}

export const UnitPageDto = createPageDto(UnitListItemDto, 'UnitPage')

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

/** Body of POST /units. The current tenant and lease are derived from the active lease and are not sent. */
export class CreateUnitDto {
  @ApiProperty({ format: 'uuid', description: 'A property of the company; fixed once the unit exists' }) propertyId!: string
  @ApiProperty({ maxLength: 30, example: 'G12', description: 'Unique within the property' }) unitNumber!: string
  @ApiProperty({ enum: UNIT_TYPES, enumName: 'UnitType' }) type!: UnitType
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, description: 'Floor area in square metres, at most two decimals' }) floorAreaSqm!: number
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: 'Empty or null leaves it unset' }) floor?: string | null
  @ApiPropertyOptional({ enum: OCCUPANCY_STATUSES, enumName: 'OccupancyStatus', description: 'vacant when omitted' })
  occupancyStatus?: OccupancyStatus
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) description?: string | null
}

/** Body of PATCH /units/{unitId}. Omitted fields are unchanged; the property cannot change. */
export class UpdateUnitDto {
  @ApiPropertyOptional({ maxLength: 30 }) unitNumber?: string
  @ApiPropertyOptional({ enum: UNIT_TYPES, enumName: 'UnitType' }) type?: UnitType
  @ApiPropertyOptional({ minimum: 0, exclusiveMinimum: true }) floorAreaSqm?: number
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: 'Empty or null clears it' }) floor?: string | null
  @ApiPropertyOptional({ enum: OCCUPANCY_STATUSES, enumName: 'OccupancyStatus', description: 'A unit with a current lease stays occupied (422)' })
  occupancyStatus?: OccupancyStatus
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'Empty or null clears it' }) description?: string | null
}

assertSchemaMatchesDto<z.infer<typeof createUnitBodySchema>, CreateUnitDto>(true)
assertSchemaMatchesDto<z.infer<typeof updateUnitBodySchema>, UpdateUnitDto>(true)
