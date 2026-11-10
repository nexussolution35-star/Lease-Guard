import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { USER_ROLES, type UserRole } from '@leaseguard/domain'

import type { AcceptedInvitation, ReceivedInvitation } from '../my-invitations.mapper'

/** An open invitation addressed to the signed-in caller. */
export class ReceivedInvitationDto implements ReceivedInvitation {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty() companyName!: string
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole', description: 'The role the caller gets on accepting' }) role!: UserRole
  @ApiPropertyOptional({ description: 'Name of the company admin who invited; absent for Nexus platform invitations' })
  invitedByName?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
}

/** Result of accepting an invitation: the company the caller now belongs to. */
export class AcceptedInvitationDto implements AcceptedInvitation {
  @ApiProperty({ format: 'uuid', description: 'Use as X-Company-Id to open the new workspace' }) companyId!: string
}
