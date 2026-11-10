import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from '@leaseguard/domain'

import { CompanySummaryDto } from '../../companies/dto/company.dto'
import type { CurrentUserProfile, MembershipWithCompany } from '../auth.mapper'

/** A domain `CompanyMembership` of the caller plus the company it opens. */
export class MembershipWithCompanyDto implements MembershipWithCompany {
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' }) role!: UserRole
  @ApiProperty({ description: 'Workspace opened by default on sign-in' }) isDefault!: boolean
  @ApiProperty({ format: 'date-time' }) joinedAt!: string
  @ApiProperty({ type: CompanySummaryDto }) company!: CompanySummaryDto
}

/**
 * The signed-in caller: the domain `User` shape whose memberships also carry each company's summary.
 * Memberships are ordered default workspace first.
 */
export class CurrentUserProfileDto implements CurrentUserProfile {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() fullName!: string
  @ApiProperty({ format: 'email' }) email!: string
  @ApiPropertyOptional() phone?: string
  @ApiPropertyOptional({ description: 'E.164 number, e.g. +27821234567' }) whatsappNumber?: string
  @ApiPropertyOptional() jobTitle?: string
  @ApiProperty({ enum: USER_STATUSES, enumName: 'UserStatus' }) status!: UserStatus
  @ApiProperty({ type: [MembershipWithCompanyDto] }) memberships!: MembershipWithCompanyDto[]
  @ApiPropertyOptional({ format: 'date-time' }) lastLoginAt?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** Body of PATCH /me. Omitted fields are unchanged; an empty string or null clears an optional field. */
export class UpdateMeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 }) fullName?: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 30 }) phone?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, description: 'E.164 number, e.g. +27821234567' })
  whatsappNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) jobTitle?: string | null
}
