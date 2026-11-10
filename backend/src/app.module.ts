import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard'
import { loggingModule } from './common/logging/logging.module'
import { ConfigModule } from './config/config.module'
import type { ApiEnv } from './config/env'
import { DatabaseModule } from './infrastructure/database/database.module'
import { HealthModule } from './infrastructure/health/health.module'
import { QueuesModule } from './infrastructure/queues/queues.module'
import { ArrangementsModule } from './modules/arrangements/arrangements.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { CommunicationsModule } from './modules/communications/communications.module'
import { CompaniesModule } from './modules/companies/companies.module'
import { InvitationsModule } from './modules/invitations/invitations.module'
import { LeasesModule } from './modules/leases/leases.module'
import { MonitoringModule } from './modules/monitoring/monitoring.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PropertiesModule } from './modules/properties/properties.module'
import { StatementsModule } from './modules/statements/statements.module'
import { TenantsModule } from './modules/tenants/tenants.module'
import { UnitsModule } from './modules/units/units.module'
import { UsersModule } from './modules/users/users.module'
import { WhatsAppAgentModule } from './modules/whatsapp-agent/whatsapp-agent.module'
import { WhatsAppConversationsModule } from './modules/whatsapp-conversations/whatsapp-conversations.module'
import { WhatsAppIntegrationModule } from './modules/whatsapp-integration/whatsapp-integration.module'
import { WhatsAppWebhookModule } from './modules/whatsapp-webhook/whatsapp-webhook.module'

/** Root module of the HTTP API process. */
@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forApi(env),
        loggingModule(env.LOG_LEVEL),
        DatabaseModule,
        QueuesModule,
        HealthModule,
        // Business modules
        AuthModule,
        UsersModule,
        InvitationsModule,
        CompaniesModule,
        PropertiesModule,
        UnitsModule,
        TenantsModule,
        LeasesModule,
        StatementsModule,
        MonitoringModule,
        ArrangementsModule,
        CommunicationsModule,
        WhatsAppIntegrationModule,
        WhatsAppWebhookModule,
        WhatsAppConversationsModule,
        WhatsAppAgentModule,
        NotificationsModule,
        AuditModule,
      ],
      providers: [
        // Every route requires a verified Supabase user unless marked @Public().
        { provide: APP_GUARD, useClass: SupabaseAuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }
  }
}
