import { Module } from '@nestjs/common'

import { WorkerCapabilitiesReader } from '../../infrastructure/capabilities/worker-capabilities.reader'
import { WhatsAppIntegrationController } from './whatsapp-integration.controller'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'

/** The WhatsApp integration status of the deployment and of the active company (read). */
@Module({
  controllers: [WhatsAppIntegrationController],
  providers: [WhatsAppIntegrationService, WorkerCapabilitiesReader],
})
export class WhatsAppIntegrationModule {}
