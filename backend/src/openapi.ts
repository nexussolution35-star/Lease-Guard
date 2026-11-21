import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { COMPANY_ID_HEADER, createServiceOpenApiDocument } from '@leaseguard/service-kit'

/** The prefix, security schemes and unprefixed health routes are shared by every service (@leaseguard/service-kit). */
export { API_PREFIX, BEARER_SECURITY_SCHEME, COMPANY_SECURITY_SCHEME, UNPREFIXED_ROUTES } from '@leaseguard/service-kit'

/** The OpenAPI document, shared by Swagger UI and `pnpm openapi:generate` (source for packages/api-client). */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return createServiceOpenApiDocument(app, {
    title: 'LeaseGuard API',
    description:
      'Commercial lease monitoring and tenant communication. LeaseGuard never collects, processes or ' +
      `facilitates payments. Company-owned resources require the ${COMPANY_ID_HEADER} header.`,
    version: '0.1.0',
  })
}
