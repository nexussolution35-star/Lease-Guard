import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  USER_ROLES,
  USER_STATUSES,
  type CompanyMembership,
  type User,
  type UserRole,
  type UserStatus,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { USER_SORT_FIELDS, type updateMemberRoleBodySchema, type userListQuerySchema } from '../users.schemas'

/** A user's role in one company. Same shape as the domain `CompanyMembership`. */
export class CompanyMembershipDto implements CompanyMembership {
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' }) role!: UserRole
  @ApiProperty({ description: 'Workspace opened by default on sign-in' }) isDefault!: boolean
  @ApiProperty({ format: 'date-time' }) joinedAt!: string
}

/** A user profile. Same shape as the domain `User`. */
export class UserDto implements User {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() fullName!: string
  @ApiProperty({ format: 'email' }) email!: string
  @ApiPropertyOptional() phone?: string
  @ApiPropertyOptional({ description: 'E.164 number, e.g. +27821234567' }) whatsappNumber?: string
  @ApiPropertyOptional() jobTitle?: string
  @ApiProperty({ enum: USER_STATUSES, enumName: 'UserStatus' }) status!: UserStatus
  @ApiProperty({
    type: [CompanyMembershipDto],
    description: 'Memberships visible in this response. Company member lists include only the active company.',
  })
  memberships!: CompanyMembershipDto[]
  @ApiPropertyOptional({ format: 'date-time' }) lastLoginAt?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const UserPageDto = createPageDto(UserDto, 'UserPage')

export class UserListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, enumName: 'UserSortField' })
  sort?: (typeof USER_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: USER_ROLES, enumName: 'UserRole' })
  role?: UserRole

  @ApiPropertyOptional({ enum: USER_STATUSES, enumName: 'UserStatus' })
  status?: UserStatus
}

assertSchemaMatchesDto<z.infer<typeof userListQuerySchema>, UserListQueryDto>(true)

/** Body of PATCH /users/:userId/role. */
export class UpdateMemberRoleDto {
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' }) role!: UserRole
}

assertSchemaMatchesDto<z.infer<typeof updateMemberRoleBodySchema>, UpdateMemberRoleDto>(true)
