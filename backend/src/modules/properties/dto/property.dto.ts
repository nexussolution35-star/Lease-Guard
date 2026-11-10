import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  SA_PROVINCES,
  STATEMENT_SOURCES,
  type Address,
  type Property,
  type PropertyStatus,
  type PropertyType,
  type SAProvince,
  type StatementSource,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { PROPERTY_SORT_FIELDS, type propertyListQuerySchema } from '../properties.schemas'

export class AddressDto implements Address {
  @ApiProperty() line1!: string
  @ApiPropertyOptional() line2?: string
  @ApiProperty() suburb!: string
  @ApiProperty() city!: string
  @ApiProperty({ enum: SA_PROVINCES, enumName: 'SAProvince' }) province!: SAProvince
  @ApiProperty({ pattern: '^[0-9]{4}$' }) postalCode!: string
  @ApiProperty({ enum: ['South Africa'] }) country!: 'South Africa'
}

/** A property in the active company. Same shape as the domain `Property`. */
export class PropertyDto implements Property {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty() name!: string
  @ApiProperty({ example: 'MSQ' }) code!: string
  @ApiProperty({ enum: PROPERTY_TYPES, enumName: 'PropertyType' }) type!: PropertyType
  @ApiProperty({ type: AddressDto }) address!: AddressDto
  @ApiProperty() description!: string
  @ApiProperty({ enum: PROPERTY_STATUSES, enumName: 'PropertyStatus' }) status!: PropertyStatus
  @ApiProperty({ description: 'Gross lettable area in square metres' }) grossLettableAreaSqm!: number
  @ApiProperty({ format: 'uuid' }) managerUserId!: string
  @ApiPropertyOptional({ format: 'uuid' }) ownerUserId?: string
  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' }) accountingSystem!: StatementSource
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const PropertyPageDto = createPageDto(PropertyDto, 'PropertyPage')

export class PropertyListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PROPERTY_SORT_FIELDS, enumName: 'PropertySortField' })
  sort?: (typeof PROPERTY_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: PROPERTY_STATUSES, enumName: 'PropertyStatus' })
  status?: PropertyStatus

  @ApiPropertyOptional({ enum: PROPERTY_TYPES, enumName: 'PropertyType' })
  type?: PropertyType
}

assertSchemaMatchesDto<z.infer<typeof propertyListQuerySchema>, PropertyListQueryDto>(true)
