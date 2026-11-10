import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { loadWorkerEnv } from './config/env'
import { WorkersModule } from './workers/workers.module'

/** Worker process: no HTTP server, only the BullMQ queues in WorkersModule. Stops cleanly on SIGTERM/SIGINT. */
async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv()
  const app = await NestFactory.createApplicationContext(WorkersModule.register(env), { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  app.enableShutdownHooks()
  await app.init()
  logger.log('LeaseGuard worker started', 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
