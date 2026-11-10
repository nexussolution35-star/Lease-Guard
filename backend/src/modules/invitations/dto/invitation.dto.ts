import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { INVITATION_STATUSES, USER_ROLES, type CompanyInvitation, type InvitationStatus, type UserRole } from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { INVITATION_SORT_FIELDS, type createInvitationBodySchema, type invitationListQuerySchema } from '../invitations.schemas'

/** An invitation to join the active company. Same shape as the domain `CompanyInvitation`. */
export class InvitationDto implements CompanyInvitation {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'email', description: 'Lower-case and trimmed' }) email!: string
  @ApiPropertyOptional({ description: 'Shown in the invitation email' }) fullName?: string
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' }) role!: UserRole
  @ApiProperty({
    enum: INVITATION_STATUSES,
    enumName: 'InvitationStatus',
    description:
      'pending: waiting to be sent; sent: emailed (or, for a user with a confirmed account, shown in their app); ' +
      'accepted: the invitee accepted while signed in with the invited email; declined: the invitee declined; ' +
      'revoked: withdrawn; failed: sending failed',
  })
  status!: InvitationStatus
  @ApiPropertyOptional({ format: 'uuid', description: 'Absent for invitations created by Nexus platform tooling' })
  invitedByUserId?: string
  @ApiPropertyOptional({ format: 'uuid', description: "The invitee's user id, once their account exists" }) invitedUserId?: string
  @ApiPropertyOptional({ description: 'Why sending failed (status failed)' }) failureReason?: string
  @ApiPropertyOptional({ format: 'date-time' }) sentAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) acceptedAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) revokedAt?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const InvitationPageDto = createPageDto(InvitationDto, 'InvitationPage')

export class InvitationListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: INVITATION_SORT_FIELDS, enumName: 'InvitationSortField', default: 'createdAt' })
  sort?: (typeof INVITATION_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: INVITATION_STATUSES, enumName: 'InvitationStatus' })
  status?: InvitationStatus
}

/** Body of POST /invitations. */
export class CreateInvitationDto {
  @ApiProperty({ format: 'email', maxLength: 320 }) email!: string
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' }) role!: UserRole
  @ApiPropertyOptional({ maxLength: 200, description: 'Shown in the invitation email' }) fullName?: string
}

assertSchemaMatchesDto<z.infer<typeof invitationListQuerySchema>, InvitationListQueryDto>(true)
assertSchemaMatchesDto<z.infer<typeof createInvitationBodySchema>, CreateInvitationDto>(true)
