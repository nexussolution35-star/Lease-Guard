import { Module } from '@nestjs/common'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { WorkerCapabilitiesReader } from '../../infrastructure/capabilities/worker-capabilities.reader'
import { EmbeddedSignupCodeExchange } from '../../infrastructure/whatsapp/embedded-signup-code-exchange'
import { WhatsAppIntegrationController } from './whatsapp-integration.controller'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'
import { WhatsAppNumbersService } from './whatsapp-numbers.service'
import { WhatsAppSetupService } from './whatsapp-setup.service'
import { EMBEDDED_SIGNUP_CODE_EXCHANGE, SIGNUP_VERIFICATION, WhatsAppOnboardingService } from './whatsapp-onboarding.service'

/** The WhatsApp integration status of the deployment and of the active company, and Meta Embedded Signup. */
@Module({
  controllers: [WhatsAppIntegrationController],
  providers: [
    WhatsAppIntegrationService,
    WhatsAppOnboardingService,
    WhatsAppNumbersService,
    WhatsAppSetupService,
    { provide: SIGNUP_VERIFICATION, useExisting: WhatsAppNumbersService },
    WorkerCapabilitiesReader,
    {
      provide: EMBEDDED_SIGNUP_CODE_EXCHANGE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        env.WHATSAPP_APP_ID && env.WHATSAPP_APP_SECRET
          ? new EmbeddedSignupCodeExchange({
              apiUrl: env.WHATSAPP_GRAPH_API_URL,
              apiVersion: env.WHATSAPP_GRAPH_API_VERSION,
              appId: env.WHATSAPP_APP_ID,
              appSecret: env.WHATSAPP_APP_SECRET,
            })
          : null,
    },
  ],
})
export class WhatsAppIntegrationModule {}
