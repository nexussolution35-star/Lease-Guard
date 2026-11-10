import { Module } from '@nestjs/common'

import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

/** The caller's in-app notifications in the active company (read and mark read). */
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
