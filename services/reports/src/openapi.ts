import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { COMPANY_ID_HEADER, createServiceOpenApiDocument } from '@leaseguard/service-kit'

/** The reports service's OpenAPI document (source of the reports client in packages/api-client). */
export function createReportsOpenApiDocument(app: INestApplication): OpenAPIObject {
  return createServiceOpenApiDocument(app, {
    title: 'LeaseGuard Reports API',
    description:
      'Company-scoped reports computed from verified records, served at /api/v1/reports through the gateway. Read-only: ' +
      `LeaseGuard never collects, processes or facilitates payments. Every report requires the ${COMPANY_ID_HEADER} header.`,
    version: '0.1.0',
  })
}
