import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Notification } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { MarkAllReadResultDto, NotificationDto, NotificationListQueryDto, NotificationPageDto } from './dto/notification.dto'
import type { MarkAllReadResult } from './notifications.mapper'
import { notificationListQuerySchema } from './notifications.schemas'
import { NotificationsService } from './notifications.service'

@ApiTags('notifications')
@CompanyScoped()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listNotifications', summary: "List the caller's notifications in the active company" })
  @ApiOkResponse({ type: NotificationPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: NotificationListQueryDto,
  ): Promise<Page<Notification>> {
    return this.notifications.list(db, company.companyId, user.userId, query)
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'markAllNotificationsRead', summary: "Mark all of the caller's notifications read" })
  @ApiOkResponse({ type: MarkAllReadResultDto })
  markAllRead(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkAllReadResult> {
    return this.notifications.markAllRead(db, company.companyId, user.userId)
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'markNotificationRead', summary: 'Mark one notification read' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  markRead(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ): Promise<Notification> {
    return this.notifications.markRead(db, company.companyId, user.userId, notificationId)
  }
}
