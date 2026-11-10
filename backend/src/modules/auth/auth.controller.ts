import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Authenticated } from '../../common/decorators/company-scoped.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { CurrentUserProfile } from './auth.mapper'
import { AuthService } from './auth.service'
import { updateMeBodySchema } from './auth.schemas'
import { CurrentUserProfileDto, UpdateMeDto } from './dto/me.dto'

/**
 * The signed-in caller. Not company-scoped: after Supabase sign-in the client reads this to choose the
 * active workspace (the default membership, or the one the user picks) for X-Company-Id.
 */
@ApiTags('auth')
@Authenticated()
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ApiOperation({ operationId: 'getMe', summary: "The caller's profile and company memberships" })
  @ApiOkResponse({ type: CurrentUserProfileDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The signed-in user has no profile' })
  me(@UserDb() db: DbClient, @CurrentUser() user: AuthenticatedUser): Promise<CurrentUserProfile> {
    return this.auth.me(db, user.userId)
  }

  @Patch('me')
  @ApiOperation({ operationId: 'updateMe', summary: "Update the caller's own profile (name, phone, WhatsApp number, job title)" })
  @ApiOkResponse({ type: CurrentUserProfileDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  updateMe(
    @UserDb() db: DbClient,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMeBodySchema)) body: UpdateMeDto,
  ): Promise<CurrentUserProfile> {
    return this.auth.updateMe(db, user.userId, body)
  }
}
