import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'

import { COMPANY_ID_HEADER } from './common/guards/company-access.guard'

export const API_PREFIX = 'api/v1'
/** Name of the OpenAPI security scheme for the Supabase access token (`addBearerAuth`'s default name). */
export const BEARER_SECURITY_SCHEME = 'bearer'
/** Name of the OpenAPI security scheme for the X-Company-Id header. */
export const COMPANY_SECURITY_SCHEME = 'company'
/** Health probes stay at the root so infrastructure checks do not depend on the API version. */
export const UNPREFIXED_ROUTES = ['health', 'health/ready']

/** The OpenAPI document, shared by Swagger UI and `pnpm openapi:generate` (source for packages/api-client). */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('LeaseGuard API')
    .setDescription(
      'Commercial lease monitoring and tenant communication. LeaseGuard never collects, processes or ' +
        `facilitates payments. Company-owned resources require the ${COMPANY_ID_HEADER} header.`,
    )
    .setVersion('0.1.0')
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
