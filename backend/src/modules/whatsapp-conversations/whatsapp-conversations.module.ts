import { Module } from '@nestjs/common'

import { WhatsAppConversationActionsService } from './whatsapp-conversation-actions.service'
import { WhatsAppConversationsController } from './whatsapp-conversations.controller'
import { WhatsAppConversationsService } from './whatsapp-conversations.service'

/**
 * The WhatsApp conversations inbox of the active company: reading, handovers and replies to contacts. The actions
 * service needs the global QueueProducer (QueuesModule) to hand replies to the delivery queue.
 */
@Module({ controllers: [WhatsAppConversationsController], providers: [WhatsAppConversationsService, WhatsAppConversationActionsService] })
export class WhatsAppConversationsModule {}
