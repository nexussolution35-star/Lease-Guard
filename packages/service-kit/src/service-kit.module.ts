import { type DynamicModule, Global, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'

import { SupabaseAuthGuard } from './auth/supabase-auth.guard'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'
import { AllExceptionsFilter } from './http/all-exceptions.filter'
import { loggingModule } from './logging/logging.module'
import { SERVICE_SETTINGS, type ServiceSettings } from './settings'

@Global()
@Module({})
class ServiceSettingsModule {
  static register(settings: ServiceSettings): DynamicModule {
    return { module: ServiceSettingsModule, providers: [{ provide: SERVICE_SETTINGS, useValue: settings }], exports: [SERVICE_SETTINGS] }
  }
}

/**
 * Everything an HTTP service shares, in one import: its settings, pino logging with request ids, the RLS-bound
 * database client factory, `/health` and `/health/ready`, the global Supabase JWT guard (every route needs a
 * signed-in user unless marked `@Public()`) and the error filter. Company scoping is per route with `@CompanyScoped()`.
 */
@Module({})
export class ServiceKitModule {
  static forRoot(settings: ServiceSettings): DynamicModule {
    return {
      module: ServiceKitModule,
      imports: [ServiceSettingsModule.register(settings), loggingModule(settings.logLevel), DatabaseModule, HealthModule],
      providers: [
        { provide: APP_GUARD, useClass: SupabaseAuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }
  }
}
