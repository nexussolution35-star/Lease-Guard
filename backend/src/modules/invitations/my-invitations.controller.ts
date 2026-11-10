import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Authenticated } from '../../common/decorators/company-scoped.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { AcceptedInvitationDto, ReceivedInvitationDto } from './dto/my-invitation.dto'
import type { AcceptedInvitation, ReceivedInvitation } from './my-invitations.mapper'
import { MyInvitationsService } from './my-invitations.service'

const NOT_FOUND = 'No open invitation with this id is addressed to the caller (also for revoked, declined or accepted ones)'

/**
 * Invitations addressed to the signed-in caller. Not company-scoped: the invitee is not a member of the
 * company yet. A membership is created only by accepting here, signed in with the invited email.
 */
@ApiTags('invitations')
@Authenticated()
@Controller('me/invitations')
export class MyInvitationsController {
  constructor(private readonly invitations: MyInvitationsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listMyInvitations',
    summary: "The caller's open invitations to join companies",
    description: 'Sent invitations whose email is the caller\'s confirmed sign-in email, newest first.',
  })
  @ApiOkResponse({ type: [ReceivedInvitationDto] })
  list(@UserDb() db: DbClient): Promise<ReceivedInvitation[]> {
    return this.invitations.list(db)
  }

  @Post(':invitationId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'acceptInvitation',
    summary: 'Accept an invitation addressed to the caller and join the company',
    description:
      'Creates the membership with the invited role (an existing member keeps their current role); it becomes the ' +
      "default workspace when the caller has none. Activates an invited profile.",
  })
  @ApiOkResponse({ type: AcceptedInvitationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND })
  accept(@UserDb() db: DbClient, @Param('invitationId', new ParseUUIDPipe()) invitationId: string): Promise<AcceptedInvitation> {
    return this.invitations.accept(db, invitationId)
  }

  @Post(':invitationId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'declineInvitation', summary: 'Decline an invitation addressed to the caller' })
  @ApiNoContentResponse({ description: 'Declined' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: NOT_FOUND })
  decline(@UserDb() db: DbClient, @Param('invitationId', new ParseUUIDPipe()) invitationId: string): Promise<void> {
    return this.invitations.decline(db, invitationId)
  }
}
