import { NestFactory } from '@nestjs/core'
import { configureServiceApp } from '@leaseguard/service-kit'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { loadApiEnv } from './config/env'
import { rawWebhookBody, WHATSAPP_WEBHOOK_ROUTE } from './modules/whatsapp-webhook/raw-body'
import { API_PREFIX, createOpenApiDocument } from './openapi'

async function bootstrap(): Promise<void> {
  const env = loadApiEnv()
  const app = await NestFactory.create(AppModule.register(env), { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)

  // The HTTP defaults every service shares (no-store, security headers, CORS, /api/v1 prefix, Swagger UI, keep-alive).
  configureServiceApp(app, {
    corsOrigins: env.API_CORS_ORIGINS,
    openApiDocument: createOpenApiDocument,
    // Meta signs the webhook's raw bytes: that route reads its body unparsed (and up to 3 MB) before Nest's JSON
    // parser, which is registered when the app initialises and then skips the already-read request.
    beforeRoutes: (nest) => nest.use(`/${API_PREFIX}/${WHATSAPP_WEBHOOK_ROUTE}`, rawWebhookBody()),
  })

  await app.listen(env.API_PORT)
  logger.log(`LeaseGuard API listening on port ${env.API_PORT} (docs at /api/docs)`, 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
