import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { UnitTenantAssignmentListItem } from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  UNIT_ASSIGNMENT_SORT_FIELDS,
  type createUnitAssignmentBodySchema,
  type unitAssignmentListQuerySchema,
} from '../unit-assignments.schemas'

/** A tenant assigned to a unit without a lease, with the tenant, unit and property named. */
export class UnitAssignmentDto implements UnitTenantAssignmentListItem {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid', description: "The unit's property" }) propertyId!: string
  @ApiProperty({ format: 'uuid' }) unitId!: string
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty({ format: 'date-time' }) assignedAt!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Who assigned the unit; absent when the member has left the company' })
  assignedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time', description: 'When the assignment ended; absent while it is current' })
  endedAt?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Who unassigned the unit' }) endedByUserId?: string
  @ApiProperty() tenantName!: string
  @ApiProperty({ example: 'G12' }) unitNumber!: string
  @ApiProperty() propertyName!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const UnitAssignmentPageDto = createPageDto(UnitAssignmentDto, 'UnitAssignmentPage')

export class UnitAssignmentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: UNIT_ASSIGNMENT_SORT_FIELDS, enumName: 'UnitAssignmentSortField', description: 'Newest first when omitted' })
  sort?: (typeof UNIT_ASSIGNMENT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional({ format: 'uuid' }) propertyId?: string

  @ApiPropertyOptional({ type: Boolean, description: 'true for current assignments only, false for ended ones only' })
  current?: boolean
}

assertSchemaMatchesDto<z.infer<typeof unitAssignmentListQuerySchema>, UnitAssignmentListQueryDto>(true)

/** Body of POST /unit-assignments. */
export class CreateUnitAssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'A tenant of the company' }) tenantId!: string
  @ApiProperty({ format: 'uuid', description: 'A unit of the company whose property is not archived' }) unitId!: string
}

assertSchemaMatchesDto<z.infer<typeof createUnitAssignmentBodySchema>, CreateUnitAssignmentDto>(true)
