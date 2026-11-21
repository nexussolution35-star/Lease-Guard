import { NestFactory } from '@nestjs/core'
import { configureServiceApp } from '@leaseguard/service-kit'
import { Logger } from 'nestjs-pino'

import { ReportsAppModule } from './app.module'
import { loadReportsEnv } from './config/env'
import { createReportsOpenApiDocument } from './openapi'

async function bootstrap(): Promise<void> {
  const env = loadReportsEnv()
  const app = await NestFactory.create(ReportsAppModule.register(env), { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  configureServiceApp(app, { corsOrigins: env.REPORTS_CORS_ORIGINS, openApiDocument: createReportsOpenApiDocument })
  await app.listen(env.REPORTS_PORT)
  logger.log(`LeaseGuard reports service listening on port ${env.REPORTS_PORT} (docs at /api/docs)`, 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
