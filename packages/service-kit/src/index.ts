/**
 * @leaseguard/service-kit: what every LeaseGuard HTTP service needs (ADR 0003), in one implementation shared by the
 * core service (backend/) and each extracted service (services/<name>): Supabase JWT verification, the active-company
 * header with membership and role checks, the RLS-bound database client, configuration validation, pino logging
 * with request ids, health and readiness, error mapping (including database errors) and the OpenAPI setup.
 */
export { ServiceKitModule } from './service-kit.module'
export { SERVICE_SETTINGS, type ServiceSettings } from './settings'
export { configureServiceApp, KEEP_ALIVE_TIMEOUT_MS, type ServiceHttpOptions } from './http-app'
export {
  API_PREFIX,
  BEARER_SECURITY_SCHEME,
  COMPANY_SECURITY_SCHEME,
  createServiceOpenApiDocument,
  UNPREFIXED_ROUTES,
  type ServiceDocumentInfo,
} from './openapi'

// Configuration
export {
  checkProductionSettings,
  corsOriginsSetting,
  InvalidEnvironmentError,
  isLoopbackHost,
  loadEnvFileKeys,
  LOG_LEVELS,
  optionalSetting,
  parseServiceEnv,
  portSetting,
  serviceEnvShape,
  type LogLevel,
  type ProductionChecks,
} from './config/env'

// Authentication and company scoping
export type { AuthenticatedUser, CompanyContext, LeaseGuardRequest } from './auth/request-context'
export { SupabaseAuthGuard } from './auth/supabase-auth.guard'
export { COMPANY_ID_HEADER, CompanyAccessGuard } from './auth/company-access.guard'
export { COMPANY_ROLES_KEY, CompanyRoleGuard } from './auth/company-role.guard'
export { Authenticated, CompanyScoped, WRITER_ROLES } from './auth/company-scoped.decorator'
export { CurrentCompany } from './auth/current-company.decorator'
export { CurrentUser } from './auth/current-user.decorator'
export { IS_PUBLIC_KEY, Public } from './auth/public.decorator'
export { UserDb } from './auth/user-db.decorator'

// Database
export { RlsClientFactory, type DbClient } from './database/rls-client.factory'
export { DatabaseModule } from './database/database.module'
export { SERVER_AUTH_OPTIONS, SupabaseNotConfiguredError } from './database/supabase-config'
export {
  conflictWithDatabaseMessage,
  httpErrorFromDatabase,
  unwrapDatabase,
  type DatabaseErrorLike,
  type DatabaseErrorOverrides,
} from './database/database-errors'

// HTTP
export { AllExceptionsFilter, type ApiErrorBody } from './http/all-exceptions.filter'
export { ApiErrorDto } from './http/api-error.dto'
export { noStore } from './http/no-store'
export { TooManyRequestsException } from './http/too-many-requests.exception'
export { assertSchemaMatchesDto, ZodValidationPipe } from './http/zod-validation.pipe'

// Logging
export { httpLoggerOptions, loggingModule, REQUEST_ID_HEADER } from './logging/logging.module'
export { REDACTED, redactQuery, redactUrl, SECRET_QUERY_PARAMS } from './logging/redact-url'

// Health
export { HealthModule } from './health/health.module'
export { ReadinessService } from './health/readiness.service'
export { DEPENDENCY_STATUSES, DependencyCheck, LivenessResponse, ReadinessChecks, ReadinessResponse, type DependencyStatus } from './health/health.responses'
