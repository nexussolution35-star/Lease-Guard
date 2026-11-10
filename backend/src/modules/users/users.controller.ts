import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { User } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { UpdateMemberRoleDto, UserDto, UserListQueryDto, UserPageDto } from './dto/user.dto'
import { updateMemberRoleBodySchema, userListQuerySchema } from './users.schemas'
import { UsersService } from './users.service'

// Company scoping is applied per route: the member list is open to every member, member management
// to company admins only. A class-level @CompanyScoped() would run the membership guard twice.
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listCompanyUsers', summary: 'List members of the active company' })
  @ApiOkResponse({ type: UserPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQueryDto,
  ): Promise<Page<User>> {
    return this.users.list(db, company.companyId, query)
  }

  @Patch(':userId/role')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'updateMemberRole',
    summary: "Change another member's role (company admins)",
    description:
      'Admins cannot change their own role (403), and the company must keep at least one active company admin (409).',
  })
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not a member of the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The change would leave the company without an active company admin' })
  updateRole(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleBodySchema)) body: UpdateMemberRoleDto,
  ): Promise<User> {
    return this.users.updateRole(db, company.companyId, user.userId, userId, body)
  }

  @Delete(':userId')
  @CompanyScoped({ roles: ['company_admin'] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'removeMember',
    summary: 'Remove another member from the active company (company admins)',
    description:
      "Removes the membership only; the user's account and other memberships stay. Admins cannot remove " +
      'themselves (403). Refused (409) for the last active company admin, and while company records (for ' +
      'example properties they manage) still name the member.',
  })
  @ApiNoContentResponse({ description: 'The member was removed' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Not a member of the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Last active company admin, or still assigned to company records' })
  remove(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.users.remove(db, company.companyId, user.userId, userId)
  }
}
