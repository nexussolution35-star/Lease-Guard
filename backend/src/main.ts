import type { Server } from 'node:http'

import { NestFactory } from '@nestjs/core'
import { SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { COMPANY_ID_HEADER } from './common/guards/company-access.guard'
import { noStore } from './common/http/no-store'
import { REQUEST_ID_HEADER } from './common/logging/logging.module'
import { loadApiEnv } from './config/env'
import { rawWebhookBody, WHATSAPP_WEBHOOK_ROUTE } from './modules/whatsapp-webhook/raw-body'
import { API_PREFIX, createOpenApiDocument, UNPREFIXED_ROUTES } from './openapi'

/**
 * How long the API keeps an idle connection open. Longer than a load balancer's idle timeout towards the
 * API (commonly 60 s), so the balancer closes first and never reuses a connection the API is closing,
 * which callers would see as an occasional 502. Node's default is 5 s.
 */
const KEEP_ALIVE_TIMEOUT_MS = 65_000

async function bootstrap(): Promise<void> {
  const env = loadApiEnv()
  const app = await NestFactory.create(AppModule.register(env), { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)

  // Responses are per user and per company while the URL is the same for every company: nothing may
  // store them. Registered first so it also covers errors, health and the webhook.
  app.use(noStore())
  // Security headers for a browser-facing API. Swagger UI loads its scripts from same-origin files,
  // so the default CSP works; only upgrade-insecure-requests is dropped because TLS terminates in
  // front of the API and the directive would break Swagger UI served over plain HTTP in development.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }))
  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    allowedHeaders: ['Authorization', 'Content-Type', COMPANY_ID_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
  })
  // Meta signs the webhook's raw bytes: that route reads its body unparsed (and up to 3 MB) before Nest's JSON
  // parser, which is registered when the app initialises and then skips the already-read request.
  app.use(`/${API_PREFIX}/${WHATSAPP_WEBHOOK_ROUTE}`, rawWebhookBody())
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES })
  app.enableShutdownHooks()

  SwaggerModule.setup('api/docs', app, () => createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  })

  const server = app.getHttpServer() as Server
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000

  await app.listen(env.API_PORT)
  logger.log(`LeaseGuard API listening on port ${env.API_PORT} (docs at /api/docs)`, 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
