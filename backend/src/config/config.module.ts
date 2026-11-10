import { type DynamicModule, Global, Module } from '@nestjs/common'

import type { ApiEnv, WorkerEnv } from './env'
import { API_ENV, WORKER_ENV } from './tokens'

/** Makes the validated configuration of the running process injectable everywhere. */
@Global()
@Module({})
export class ConfigModule {
  static forApi(env: ApiEnv): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: API_ENV, useValue: env }], exports: [API_ENV] }
  }

  static forWorker(env: WorkerEnv): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: WORKER_ENV, useValue: env }], exports: [WORKER_ENV] }
  }
}
