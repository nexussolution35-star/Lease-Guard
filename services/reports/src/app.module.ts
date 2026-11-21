import { type DynamicModule, Module } from '@nestjs/common'
import { ServiceKitModule } from '@leaseguard/service-kit'

import { CatalogueModule } from './catalogue/catalogue.module'
import { type ReportsEnv, reportsServiceSettings } from './config/env'
import { ReportsModule } from './reports/reports.module'

/**
 * Root module of the reports service. The service kit supplies logging, the RLS-bound database client, health and
 * readiness, the global Supabase JWT guard and the error filter; routes are company-scoped with `@CompanyScoped()`.
 */
@Module({})
export class ReportsAppModule {
  static register(env: ReportsEnv): DynamicModule {
    return {
      module: ReportsAppModule,
      imports: [ServiceKitModule.forRoot(reportsServiceSettings(env)), CatalogueModule, ReportsModule],
    }
  }
}
