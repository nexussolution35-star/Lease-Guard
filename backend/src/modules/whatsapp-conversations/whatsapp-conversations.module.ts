import { Module } from '@nestjs/common'

import { WhatsAppConversationsController } from './whatsapp-conversations.controller'
import { WhatsAppConversationsService } from './whatsapp-conversations.service'

/** The WhatsApp conversations inbox of the active company (read-only). */
@Module({ controllers: [WhatsAppConversationsController], providers: [WhatsAppConversationsService] })
export class WhatsAppConversationsModule {}
