import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  BUSINESS_TYPES,
  TENANT_STATUSES,
  type BusinessType,
  type Tenant,
  type TenantContact,
  type TenantStatus,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { TENANT_SORT_FIELDS, type tenantListQuerySchema } from '../tenants.schemas'

export class TenantContactDto implements TenantContact {
  @ApiProperty() fullName!: string
  @ApiProperty({ example: 'Financial manager' }) role!: string
  @ApiProperty() phone!: string
  @ApiPropertyOptional({ format: 'email' }) email?: string
}

/** A tenant in the active company. Same shape as the domain `Tenant`. */
export class TenantDto implements Tenant {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty() legalName!: string
  @ApiProperty() tradingName!: string
  @ApiProperty({ enum: BUSINESS_TYPES, enumName: 'BusinessType' }) businessType!: BusinessType
  @ApiPropertyOptional() registrationNumber?: string
  @ApiPropertyOptional() vatNumber?: string
  @ApiProperty({ type: TenantContactDto }) primaryContact!: TenantContactDto
  @ApiProperty({ pattern: '^\\+[1-9][0-9]{7,14}$', description: 'E.164 number used for WhatsApp' })
  whatsappNumber!: string
  @ApiProperty({ description: 'Numbers must be verified before automated communication is enabled' })
  whatsappVerified!: boolean
  @ApiProperty() whatsappOptedOut!: boolean
  @ApiPropertyOptional({ format: 'email' }) email?: string
  @ApiProperty({ enum: TENANT_STATUSES, enumName: 'TenantStatus' }) status!: TenantStatus
  @ApiProperty() industry!: string
  @ApiPropertyOptional() notes?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const TenantPageDto = createPageDto(TenantDto, 'TenantPage')

export class TenantListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: TENANT_SORT_FIELDS, enumName: 'TenantSortField' })
  sort?: (typeof TENANT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: TENANT_STATUSES, enumName: 'TenantStatus' })
  status?: TenantStatus

  @ApiPropertyOptional({ enum: BUSINESS_TYPES, enumName: 'BusinessType' })
  businessType?: BusinessType
}

assertSchemaMatchesDto<z.infer<typeof tenantListQuerySchema>, TenantListQueryDto>(true)
