import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  BUSINESS_TYPES,
  LEASE_STATUSES,
  TENANT_STATUSES,
  type BusinessType,
  type LeaseStatus,
  type Tenant,
  type TenantContact,
  type TenantLeaseSummary,
  type TenantListItem,
  type TenantStatus,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  TENANT_SORT_FIELDS,
  type createTenantBodySchema,
  type tenantListQuerySchema,
  type updateTenantBodySchema,
  type validateTenantWhatsAppBodySchema,
} from '../tenants.schemas'

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
  @ApiPropertyOptional({ description: "The tenant's account reference in the company's own system (tenant or debtor code)" }) accountReference?: string
  @ApiPropertyOptional() vatNumber?: string
  @ApiProperty({ type: TenantContactDto }) primaryContact!: TenantContactDto
  @ApiProperty({ pattern: '^\\+[1-9][0-9]{7,14}$', description: 'E.164 number used for WhatsApp' })
  whatsappNumber!: string
  @ApiProperty({ description: 'Numbers must be validated before automated communication is enabled' })
  whatsappVerified!: boolean
  @ApiPropertyOptional({ format: 'date-time', description: 'When a member validated the current number; absent while it is not validated' })
  whatsappValidatedAt?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Who validated the current number; absent for a background job or while not validated' })
  whatsappValidatedByUserId?: string
  @ApiProperty() whatsappOptedOut!: boolean
  @ApiPropertyOptional({ format: 'email' }) email?: string
  @ApiProperty({ enum: TENANT_STATUSES, enumName: 'TenantStatus' }) status!: TenantStatus
  @ApiProperty() industry!: string
  @ApiPropertyOptional() notes?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** The lease a tenant list row shows, with its unit and property. Same shape as the domain `TenantLeaseSummary`. */
export class TenantLeaseSummaryDto implements TenantLeaseSummary {
  @ApiProperty({ format: 'uuid' }) leaseId!: string
  @ApiProperty({ example: 'ACP-001' }) reference!: string
  @ApiProperty({ enum: LEASE_STATUSES, enumName: 'LeaseStatus' }) status!: LeaseStatus
  @ApiProperty() verified!: boolean
  @ApiProperty({ format: 'uuid' }) unitId!: string
  @ApiProperty({ example: '001' }) unitNumber!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty() propertyName!: string
}

/** A tenant list row. Same shape as the domain `TenantListItem`. */
export class TenantListItemDto extends TenantDto implements TenantListItem {
  @ApiPropertyOptional({
    type: TenantLeaseSummaryDto,
    description:
      "The tenant's current lease: in force first, then being set up, then ended; the latest commencement among equals. " +
      'With a property filter, the current lease in that property. Absent when the tenant has no lease.',
  })
  currentLease?: TenantLeaseSummaryDto

  @ApiProperty({ description: 'Leases of the tenant (in the filtered property, when filtered)' })
  leaseCount!: number
}

export const TenantPageDto = createPageDto(TenantListItemDto, 'TenantPage')

export class TenantListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: TENANT_SORT_FIELDS, enumName: 'TenantSortField' })
  sort?: (typeof TENANT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: TENANT_STATUSES, enumName: 'TenantStatus' })
  status?: TenantStatus

  @ApiPropertyOptional({ enum: BUSINESS_TYPES, enumName: 'BusinessType' })
  businessType?: BusinessType

  @ApiPropertyOptional({ format: 'uuid', description: 'Only tenants with a lease in this property' })
  propertyId?: string
}

assertSchemaMatchesDto<z.infer<typeof tenantListQuerySchema>, TenantListQueryDto>(true)

const WHATSAPP_INPUT =
  'Typed as people write it (082 123 4567, +27 82 123 4567); stored in E.164. A South African national number gains +27. ' +
  'Anything else is 400 with the format to use.'

/** The contact person in POST /tenants. */
export class TenantContactInputDto {
  @ApiProperty({ maxLength: 200 }) fullName!: string
  @ApiPropertyOptional({ maxLength: 100, description: 'Empty when omitted' }) role?: string
  @ApiPropertyOptional({ maxLength: 30, description: 'The WhatsApp number when omitted' }) phone?: string
  @ApiPropertyOptional({ type: String, format: 'email', nullable: true, description: 'Empty or null clears it' }) email?: string | null
}

/** The contact person in PATCH /tenants/{tenantId}: omitted fields are unchanged. */
export class TenantContactChangesDto {
  @ApiPropertyOptional({ maxLength: 200 }) fullName?: string
  @ApiPropertyOptional({ maxLength: 100 }) role?: string
  @ApiPropertyOptional({ maxLength: 30 }) phone?: string
  @ApiPropertyOptional({ type: String, format: 'email', nullable: true, description: 'Empty or null clears it' }) email?: string | null
}

/** Body of POST /tenants. */
export class CreateTenantDto {
  @ApiProperty({ maxLength: 200, description: 'Registered business name' }) legalName!: string
  @ApiPropertyOptional({ maxLength: 200, description: 'The registered name when omitted' }) tradingName?: string
  @ApiProperty({ enum: BUSINESS_TYPES, enumName: 'BusinessType' }) businessType!: BusinessType
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 }) registrationNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: 'Unique per company, case ignored' }) accountReference?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 }) vatNumber?: string | null
  @ApiProperty({ type: TenantContactInputDto }) primaryContact!: TenantContactInputDto
  @ApiProperty({ example: '+27 82 123 4567', description: WHATSAPP_INPUT }) whatsappNumber!: string
  @ApiPropertyOptional({ type: String, format: 'email', nullable: true }) email?: string | null
  @ApiPropertyOptional({ enum: TENANT_STATUSES, enumName: 'TenantStatus', description: 'prospective when omitted' }) status?: TenantStatus
  @ApiPropertyOptional({ maxLength: 100, description: 'Empty when omitted' }) industry?: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) notes?: string | null
}

/** Body of PATCH /tenants/{tenantId}. Omitted fields are unchanged; empty or null clears an optional field. */
export class UpdateTenantDto {
  @ApiPropertyOptional({ maxLength: 200 }) legalName?: string
  @ApiPropertyOptional({ maxLength: 200 }) tradingName?: string
  @ApiPropertyOptional({ enum: BUSINESS_TYPES, enumName: 'BusinessType' }) businessType?: BusinessType
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 }) registrationNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: 'Unique per company, case ignored' }) accountReference?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 }) vatNumber?: string | null
  @ApiPropertyOptional({ type: TenantContactChangesDto }) primaryContact?: TenantContactChangesDto
  @ApiPropertyOptional({
    example: '+27 82 123 4567',
    description: `${WHATSAPP_INPUT} A different number is unvalidated again until it is validated.`,
  })
  whatsappNumber?: string
  @ApiPropertyOptional({ type: String, format: 'email', nullable: true }) email?: string | null
  @ApiPropertyOptional({ enum: TENANT_STATUSES, enumName: 'TenantStatus' }) status?: TenantStatus
  @ApiPropertyOptional({ maxLength: 100 }) industry?: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) notes?: string | null
}

assertSchemaMatchesDto<z.infer<typeof createTenantBodySchema>, CreateTenantDto>(true)
assertSchemaMatchesDto<z.infer<typeof updateTenantBodySchema>, UpdateTenantDto>(true)

/** Body of POST /tenants/{tenantId}/whatsapp-validation. */
export class ValidateTenantWhatsAppDto {
  @ApiProperty({
    example: '+27 82 123 4567',
    description: 'The number the person checked with the tenant, typed or in E.164. It must still be the number on record (409 otherwise).',
  })
  whatsappNumber!: string
}

assertSchemaMatchesDto<z.infer<typeof validateTenantWhatsAppBodySchema>, ValidateTenantWhatsAppDto>(true)
