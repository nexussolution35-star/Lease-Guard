import { Module } from '@nestjs/common'

import { WhatsAppWebhookController } from './whatsapp-webhook.controller'
import { WhatsAppWebhookService } from './whatsapp-webhook.service'

/** Meta's shared WhatsApp webhook: authenticates Meta and queues payloads for the worker's routing. */
@Module({ controllers: [WhatsAppWebhookController], providers: [WhatsAppWebhookService] })
export class WhatsAppWebhookModule {}
