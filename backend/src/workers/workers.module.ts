import { type DynamicModule, Module, type Provider } from '@nestjs/common'

import { loggingModule } from '../common/logging/logging.module'
import { ConfigModule } from '../config/config.module'
import type { WorkerEnv } from '../config/env'
import { WORKER_ENV } from '../config/tokens'
import { SupabaseAuthAdmin } from '../infrastructure/auth/auth-admin.client'
import { ServiceRoleClientFactory } from '../infrastructure/database/service-role-client.factory'
import { DocumentProcessingClient } from '../infrastructure/document-processing/document-processing.client'
import { createWhatsAppChannels } from '../infrastructure/whatsapp/database-whatsapp-channels'
import { WhatsAppChannels } from '../infrastructure/whatsapp/whatsapp-channels'
import { WorkerCapabilitiesReporter } from './capabilities/worker-capabilities.reporter'
import { UserInvitationProcessor } from './invitations/user-invitation.processor'
import { JobRunRecorderService } from './jobs/job-run-recorder'
import { ProcessorRuntime } from './jobs/processor-runtime'
import { MessageDeliveryProcessor } from './messaging/message-delivery.processor'
import { ArrangementRemindersProcessor } from './monitoring/arrangement-reminders.processor'
import { ArrearsMonitoringProcessor } from './monitoring/arrears-monitoring.processor'
import { LeaseMonitoringProcessor } from './monitoring/lease-monitoring.processor'
import { WorkerQueues } from './queues/worker-queues'
import { MonitoringDispatchProcessor } from './scheduling/monitoring-dispatch.processor'
import { MonitoringScheduler } from './scheduling/monitoring-scheduler'
import { Clock } from './shared/clock'
import { WhatsAppWebhookProcessor } from './whatsapp/inbound-webhook.processor'
import { WhatsAppNumberVerificationProcessor } from './whatsapp/number-verification.processor'
import { StatementFiles } from './shared/statement-files'
import { StatementProcessingProcessor } from './statements/statement-processing.processor'

/** Outbound HTTP clients and the WhatsApp channel module, configured from the validated worker environment. */
const clientProviders: Provider[] = [
  {
    provide: DocumentProcessingClient,
    inject: [WORKER_ENV],
    useFactory: (env: WorkerEnv) =>
      new DocumentProcessingClient({ baseUrl: env.DOCUMENT_PROCESSING_URL, token: env.DOCUMENT_PROCESSING_TOKEN }),
  },
  {
    // Env-held tokens (secret://env/…) are read from the process environment, which loadWorkerEnv
    // filled with the WHATSAPP_ACCESS_TOKEN_<company> variables.
    provide: WhatsAppChannels,
    inject: [WORKER_ENV, ServiceRoleClientFactory],
    useFactory: (env: WorkerEnv, clients: ServiceRoleClientFactory) =>
      createWhatsAppChannels(
        clients,
        { apiUrl: env.WHATSAPP_GRAPH_API_URL, apiVersion: env.WHATSAPP_GRAPH_API_VERSION },
        process.env,
        // The Meta app's credentials authenticate debug_token during number verification.
        env.WHATSAPP_APP_ID && env.WHATSAPP_APP_SECRET ? { appId: env.WHATSAPP_APP_ID, appSecret: env.WHATSAPP_APP_SECRET } : null,
      ),
  },
]

/** One processor per queue in the registry (QUEUE_NAMES); each starts its BullMQ worker in onModuleInit. */
const processors: Provider[] = [
  MonitoringDispatchProcessor,
  LeaseMonitoringProcessor,
  ArrearsMonitoringProcessor,
  ArrangementRemindersProcessor,
  StatementProcessingProcessor,
  MessageDeliveryProcessor,
  UserInvitationProcessor,
  WhatsAppNumberVerificationProcessor,
  WhatsAppWebhookProcessor,
]

/**
 * Root module of the worker process. It is the only module that provides the service-role client.
 * Infrastructure (queues, runtime, job-run recording, HTTP clients) is listed before the processors that
 * depend on it; the scheduler registers the daily monitoring dispatch once the application has started.
 */
@Module({})
export class WorkersModule {
  static register(env: WorkerEnv): DynamicModule {
    return {
      module: WorkersModule,
      imports: [ConfigModule.forWorker(env), loggingModule(env.LOG_LEVEL)],
      providers: [
        WorkerQueues,
        ServiceRoleClientFactory,
        SupabaseAuthAdmin,
        Clock,
        StatementFiles,
        JobRunRecorderService,
        ProcessorRuntime,
        ...clientProviders,
        ...processors,
        MonitoringScheduler,
        WorkerCapabilitiesReporter,
      ],
    }
  }
}
