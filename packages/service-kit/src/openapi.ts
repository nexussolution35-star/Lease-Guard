import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'

import { COMPANY_ID_HEADER } from './auth/company-access.guard'

/** Every service serves its routes under this prefix; the gateway routes by the path that follows it. */
export const API_PREFIX = 'api/v1'
/** Name of the OpenAPI security scheme for the Supabase access token (`addBearerAuth`'s default name). */
export const BEARER_SECURITY_SCHEME = 'bearer'
/** Name of the OpenAPI security scheme for the X-Company-Id header. */
export const COMPANY_SECURITY_SCHEME = 'company'
/** Health probes stay at the root so infrastructure checks do not depend on the API version. */
export const UNPREFIXED_ROUTES = ['health', 'health/ready']

export interface ServiceDocumentInfo {
  title: string
  description: string
  version: string
}

/**
 * A service's OpenAPI document, shared by its Swagger UI and its `openapi:generate` script (the source of its
 * generated client in packages/api-client). Every service declares the same two security schemes.
 */
export function createServiceOpenApiDocument(app: INestApplication, info: ServiceDocumentInfo): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(info.title)
    .setDescription(info.description)
    .setVersion(info.version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token' }, BEARER_SECURITY_SCHEME)
    // The active company travels in a header on every company-owned request. Declaring it as a security
    // scheme (rather than a per-operation parameter) lets clients set it once, like the bearer token.
    .addApiKey(
      { type: 'apiKey', in: 'header', name: COMPANY_ID_HEADER, description: 'Active company (workspace) id; the caller must be a member' },
      COMPANY_SECURITY_SCHEME,
    )
    .build()
  return SwaggerModule.createDocument(app, config)
}
