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
import {
  PROPERTY_EDITABLE_STATUSES,
  PROPERTY_SORT_FIELDS,
  type createPropertyBodySchema,
  type propertyListQuerySchema,
  type updatePropertyBodySchema,
} from '../properties.schemas'

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

type EditablePropertyStatus = (typeof PROPERTY_EDITABLE_STATUSES)[number]

/** A property's address in a request. The country is always South Africa and is not sent. */
export class PropertyAddressInputDto {
  @ApiProperty({ maxLength: 200 }) line1!: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, description: 'Empty or null clears it' }) line2?: string | null
  @ApiProperty({ maxLength: 100 }) suburb!: string
  @ApiProperty({ maxLength: 100 }) city!: string
  @ApiProperty({ enum: SA_PROVINCES, enumName: 'SAProvince' }) province!: SAProvince
  @ApiProperty({ pattern: '^[0-9]{4}$' }) postalCode!: string
}

/** Body of POST /properties. */
export class CreatePropertyDto {
  @ApiProperty({ maxLength: 200 }) name!: string
  @ApiProperty({ pattern: '^[A-Za-z0-9]{2,8}$', description: 'Upper-cased; unique in the company; fixed once created (lease references use it)' })
  code!: string
  @ApiProperty({ enum: PROPERTY_TYPES, enumName: 'PropertyType' }) type!: PropertyType
  @ApiPropertyOptional({ enum: PROPERTY_EDITABLE_STATUSES, enumName: 'EditablePropertyStatus', description: 'active when omitted' })
  status?: EditablePropertyStatus
  @ApiProperty({ type: PropertyAddressInputDto }) address!: PropertyAddressInputDto
  @ApiPropertyOptional({ maxLength: 2000 }) description?: string
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, description: 'Gross lettable area in square metres, at most two decimals' }) grossLettableAreaSqm!: number
  @ApiProperty({ format: 'uuid', description: 'A company admin or property manager of the company' }) managerUserId!: string
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A member of the company' }) ownerUserId?: string | null
  @ApiProperty({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' }) accountingSystem!: StatementSource
}

/** Body of PATCH /properties/{propertyId}. Omitted fields are unchanged; an address replaces the whole address. */
export class UpdatePropertyDto {
  @ApiPropertyOptional({ maxLength: 200 }) name?: string
  @ApiPropertyOptional({ enum: PROPERTY_TYPES, enumName: 'PropertyType' }) type?: PropertyType
  @ApiPropertyOptional({ enum: PROPERTY_EDITABLE_STATUSES, enumName: 'EditablePropertyStatus' }) status?: EditablePropertyStatus
  @ApiPropertyOptional({ type: PropertyAddressInputDto }) address?: PropertyAddressInputDto
  @ApiPropertyOptional({ maxLength: 2000 }) description?: string
  @ApiPropertyOptional({ minimum: 0, exclusiveMinimum: true }) grossLettableAreaSqm?: number
  @ApiPropertyOptional({ format: 'uuid' }) managerUserId?: string
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'null removes the owner' }) ownerUserId?: string | null
  @ApiPropertyOptional({ enum: STATEMENT_SOURCES, enumName: 'StatementSource' }) accountingSystem?: StatementSource
}

assertSchemaMatchesDto<z.infer<typeof createPropertyBodySchema>, CreatePropertyDto>(true)
assertSchemaMatchesDto<z.infer<typeof updatePropertyBodySchema>, UpdatePropertyDto>(true)
