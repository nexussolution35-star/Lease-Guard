import { Module } from '@nestjs/common'

import { MessageTemplatesController } from './message-templates.controller'
import { MessageTemplatesService } from './message-templates.service'

/** Settings → Message templates: which WhatsApp template sends each message type, and syncing them from Meta. */
@Module({ controllers: [MessageTemplatesController], providers: [MessageTemplatesService] })
export class MessageTemplatesModule {}
