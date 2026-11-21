import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'

import { COMPANY_ID_HEADER } from './auth/company-access.guard'
import { noStore } from './http/no-store'
import { REQUEST_ID_HEADER } from './logging/logging.module'
import { API_PREFIX, UNPREFIXED_ROUTES } from './openapi'

/**
 * How long a service keeps an idle connection open. Longer than a load balancer's or the gateway's idle timeout
 * towards it (commonly 60 s), so the balancer closes first and never reuses a connection the service is closing,
 * which callers would see as an occasional 502. Node's default is 5 s.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000

export interface ServiceHttpOptions {
  corsOrigins: readonly string[]
  /** The service's OpenAPI document, served by Swagger UI at /api/docs (JSON at /api/docs-json). */
  openApiDocument: (app: INestApplication) => OpenAPIObject
  /** Middleware that must run before Nest's body parsers, such as a raw-body route. */
  beforeRoutes?: (app: INestApplication) => void
}

/**
 * The HTTP defaults every service shares: `Cache-Control: no-store`, security headers, CORS for the
 * Authorization, X-Company-Id and X-Request-Id headers, the `/api/v1` prefix (health stays at the root),
 * shutdown hooks, Swagger UI and the keep-alive timeout. Call before `app.listen`.
 */
export function configureServiceApp(app: INestApplication, options: ServiceHttpOptions): void {
  // Responses are per user and per company while the URL is the same for every company: nothing may
  // store them. Registered first so it also covers errors and health.
  app.use(noStore())
  // Security headers for a browser-facing API. Swagger UI loads its scripts from same-origin files,
  // so the default CSP works; only upgrade-insecure-requests is dropped because TLS terminates in
  // front of the service and the directive would break Swagger UI served over plain HTTP in development.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }))
  app.enableCors({
    origin: [...options.corsOrigins],
    allowedHeaders: ['Authorization', 'Content-Type', COMPANY_ID_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
  })
  options.beforeRoutes?.(app)
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES })
  app.enableShutdownHooks()

  SwaggerModule.setup('api/docs', app, () => options.openApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  })

  const server = app.getHttpServer() as Server
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000
}
