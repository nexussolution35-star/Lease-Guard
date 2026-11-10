import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { UserRole } from '@leaseguard/domain'

import { ApiErrorDto } from '../http/api-error.dto'
import { CompanyAccessGuard } from '../guards/company-access.guard'
import { COMPANY_ROLES_KEY, CompanyRoleGuard } from '../guards/company-role.guard'
import { BEARER_SECURITY_SCHEME, COMPANY_SECURITY_SCHEME } from '../../openapi'

/** Company roles allowed to change company data; mirrors `private.can_write` in the database. */
export const WRITER_ROLES: readonly UserRole[] = ['company_admin', 'property_manager']

/** Responses every signed-in route can give. */
function signedInResponses(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired access token' }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Authentication or database unavailable' }),
  )
}

/**
 * Documents and enforces a signed-in caller (the global SupabaseAuthGuard). Use on routes that are not
 * tied to one company, such as `GET /me`. OpenAPI security: `[{ bearer: [] }]`.
 */
export function Authenticated(): ClassDecorator & MethodDecorator {
  return applyDecorators(ApiBearerAuth(BEARER_SECURITY_SCHEME), signedInResponses())
}

/**
 * Company-owned resources: requires the X-Company-Id header naming a company the caller belongs to,
 * optionally restricted to `roles`. Read the company with `@CurrentCompany()` and query only through
 * `@UserDb()`, so Row Level Security applies as well.
 *
 * OpenAPI security is ONE requirement object naming both schemes, `[{ bearer: [], company: [] }]`: the
 * caller needs the access token AND the X-Company-Id header (separate entries would mean either one).
 * It deliberately does not reuse `Authenticated()`, whose separate bearer entry would add an OR.
 */
export function CompanyScoped(options: { roles?: readonly UserRole[] } = {}): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiSecurity({ [BEARER_SECURITY_SCHEME]: [], [COMPANY_SECURITY_SCHEME]: [] }),
    signedInResponses(),
    SetMetadata(COMPANY_ROLES_KEY, options.roles ?? []),
    UseGuards(CompanyAccessGuard, CompanyRoleGuard),
    ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid request or missing X-Company-Id header' }),
    ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not a member of the company, or role not allowed' }),
  )
}
