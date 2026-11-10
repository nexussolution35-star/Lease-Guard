import { NestFactory } from '@nestjs/core'
import { SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { COMPANY_ID_HEADER } from './common/guards/company-access.guard'
import { REQUEST_ID_HEADER } from './common/logging/logging.module'
import { loadApiEnv } from './config/env'
import { API_PREFIX, createOpenApiDocument, UNPREFIXED_ROUTES } from './openapi'

async function bootstrap(): Promise<void> {
  const env = loadApiEnv()
  const app = await NestFactory.create(AppModule.register(env), { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)

  // Security headers for a browser-facing API. Swagger UI loads its scripts from same-origin files,
  // so the default CSP works; only upgrade-insecure-requests is dropped because TLS terminates in
  // front of the API and the directive would break Swagger UI served over plain HTTP in development.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }))
  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    allowedHeaders: ['Authorization', 'Content-Type', COMPANY_ID_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
  })
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES })
  app.enableShutdownHooks()

  SwaggerModule.setup('api/docs', app, () => createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  })

  await app.listen(env.API_PORT)
  logger.log(`LeaseGuard API listening on port ${env.API_PORT} (docs at /api/docs)`, 'Bootstrap')
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
