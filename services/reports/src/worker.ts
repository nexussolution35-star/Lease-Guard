import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { loadReportsWorkerEnv } from './worker/worker-env'
import { ReportsWorkerModule } from './worker/reports-worker.module'

/**
 * The reports worker (ticket R-07, ADR 0003): a separate process from the reports HTTP service, with no HTTP. On each
 * company's owner summary day it computes, stores and hands every property owner's weekly summary to the core
 * messaging pipeline (queue `owner-summary-delivery`); the core worker records and sends it. Run: node dist/worker.js.
 */
async function bootstrap(): Promise<void> {
  const env = loadReportsWorkerEnv()
  const app = await NestFactory.createApplicationContext(ReportsWorkerModule.register(env), { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()
  app.get(Logger).log('LeaseGuard reports worker started', 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
