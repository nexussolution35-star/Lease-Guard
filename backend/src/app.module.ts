import { type DynamicModule, Module } from '@nestjs/common'
import { ServiceKitModule } from '@leaseguard/service-kit'

import { ConfigModule } from './config/config.module'
import { apiServiceSettings, type ApiEnv } from './config/env'
import { QueuesModule } from './infrastructure/queues/queues.module'
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module'
import { AddressSuggestionsModule } from './modules/address-suggestions/address-suggestions.module'
import { ArrangementsModule } from './modules/arrangements/arrangements.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { CommunicationsModule } from './modules/communications/communications.module'
import { CompaniesModule } from './modules/companies/companies.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { InvitationsModule } from './modules/invitations/invitations.module'
import { LeasesModule } from './modules/leases/leases.module'
import { MessageTemplatesModule } from './modules/message-templates/message-templates.module'
import { MonitoringModule } from './modules/monitoring/monitoring.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PortfolioImportsModule } from './modules/portfolio-imports/portfolio-imports.module'
import { PropertiesModule } from './modules/properties/properties.module'
import { StatementsModule } from './modules/statements/statements.module'
import { TenantsModule } from './modules/tenants/tenants.module'
import { UnitAssignmentsModule } from './modules/unit-assignments/unit-assignments.module'
import { UnitsModule } from './modules/units/units.module'
import { UsersModule } from './modules/users/users.module'
import { WhatsAppAgentModule } from './modules/whatsapp-agent/whatsapp-agent.module'
import { WhatsAppConversationsModule } from './modules/whatsapp-conversations/whatsapp-conversations.module'
import { WhatsAppIntegrationModule } from './modules/whatsapp-integration/whatsapp-integration.module'
import { WhatsAppWebhookModule } from './modules/whatsapp-webhook/whatsapp-webhook.module'

/**
 * Root module of the core service's HTTP API process. The shared service kit (ADR 0003) supplies logging, the
 * RLS-bound database client, health and readiness, the global Supabase JWT guard (every route requires a verified
 * user unless marked @Public()) and the error filter.
 */
@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forApi(env),
        ServiceKitModule.forRoot(apiServiceSettings(env)),
        QueuesModule,
        RateLimitModule,
        // Business modules
        AuthModule,
        UsersModule,
        InvitationsModule,
        CompaniesModule,
        PropertiesModule,
        PortfolioImportsModule,
        UnitsModule,
        UnitAssignmentsModule,
        TenantsModule,
        LeasesModule,
        StatementsModule,
        MonitoringModule,
        ArrangementsModule,
        CommunicationsModule,
        MessageTemplatesModule,
        WhatsAppIntegrationModule,
        WhatsAppWebhookModule,
        WhatsAppConversationsModule,
        WhatsAppAgentModule,
        NotificationsModule,
        AuditModule,
        DashboardModule,
        AddressSuggestionsModule,
      ],
    }
  }
}
