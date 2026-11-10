# API conventions

The LeaseGuard HTTP API is the NestJS process started by `backend/src/main.ts`. This page describes
the conventions it implements. The authoritative contract is the generated OpenAPI document,
`backend/openapi.json`; while the API runs, Swagger UI is served at `/api/docs` and the JSON document at
`/api/docs-json`.

The API never collects, processes or facilitates payments. Statement balances and payment
arrangements are monitoring records.

## Base path and versioning

- Business routes are under `/api/v1` (`API_PREFIX` in `backend/src/openapi.ts`).
- Health probes stay at the root: `GET /health` (liveness) and `GET /health/ready` (readiness: 503
  until Redis answers and Supabase is reachable). They are the only `@Public()` routes.
- Every response carries an `X-Request-Id` header. A caller-supplied `X-Request-Id` (8–128 word
  characters or `-`) is reused; otherwise a UUID is generated.
- CORS allows only the origins in `API_CORS_ORIGINS` and the headers `Authorization`, `Content-Type`,
  `X-Company-Id` and `X-Request-Id`.

## Authentication

Every route except the health probes requires a Supabase access token:

```http
Authorization: Bearer <Supabase access token>
```

The global `SupabaseAuthGuard` verifies the token with supabase-js `auth.getClaims` and accepts only
signed-in user tokens (`role = authenticated` with a subject). The anon key and the service-role key
are refused. Missing, malformed or expired tokens get 401; if Supabase Auth is unreachable or not
configured, 503. In OpenAPI this is the `bearer` security scheme.

## Company scoping

Company-owned resources need the active company (workspace) in a header:

```http
X-Company-Id: <company uuid>
```

| Situation | Status |
| --- | --- |
| Header missing or not a UUID | 400 |
| Caller has no `company_users` row in that company (or their profile is not active) | 403 |
| Record belongs to another company (even when its id is known) | 404 |

The header is declared in OpenAPI as an `apiKey` security scheme named `company` (`in: header`,
`name: x-company-id`), so generated clients set it once like the bearer token. Each company-scoped
operation lists `bearer` and `company` as two separate entries of its `security` array. Note that in
OpenAPI semantics separate entries mean "either"; the server always requires both.

Routes that are not tied to one company (`GET /me`, `GET /companies`, `GET /companies/{companyId}`)
need only the bearer token; Row Level Security limits them to the caller's own companies.

## Roles

Roles come from the caller's membership in the `X-Company-Id` company (`company_users.role`):
`company_admin`, `property_manager`, `property_owner`, `read_only`.

- Reads: any member.
- Writes: `WRITER_ROLES` = `company_admin`, `property_manager`
  (`backend/src/common/decorators/company-scoped.decorator.ts`; mirrors `private.can_write` in the
  database).
- Audit log: `AUDIT_READER_ROLES` = `company_admin`, `property_manager`, `read_only`.

A disallowed role gets 403 from `CompanyRoleGuard`. Row Level Security enforces the same rules in the
database.

## Error body

Every failing request returns `ApiErrorBody` (`backend/src/common/filters/all-exceptions.filter.ts`,
documented as `ApiErrorDto`):

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "You do not have access to this company",
  "requestId": "4f6c1d0e-…"
}
```

- `message` is a string, or an array with one entry per validation problem.
- `requestId` matches the `X-Request-Id` response header and the API's log lines.
- Unexpected errors become a generic 500; details are logged, never returned.
- Database errors are mapped by `httpErrorFromDatabase`: no row → 404, unique violation → 409, RLS or
  privilege denial → 403, invalid value → 400, integrity or trigger rule → 422 (a trigger's own
  message is returned for business rules), unreachable database → 503.

Some operations document extra bodies: `registerStatement` answers an identical file with 409 and a
`DuplicateStatementErrorDto` naming the existing statement.

## Validation

Request bodies and query strings are validated with zod through `ZodValidationPipe`
(`backend/src/common/pipes/zod-validation.pipe.ts`). Failures are 400 with one `path: message` entry
per problem. Each schema has a matching OpenAPI DTO class, and `assertSchemaMatchesDto` keeps the two
in step at compile time. Path ids are validated with `ParseUUIDPipe`, so a non-UUID id is 400.

## Lists: paging, sorting, search

Every list endpoint accepts the shared query parameters from `backend/src/common/http/pagination.ts`:

| Parameter | Default | Rules |
| --- | --- | --- |
| `page` | 1 | integer ≥ 1 |
| `pageSize` | 25 | integer 1–100 |
| `search` | none | trimmed, at most 100 characters, case-insensitive match on the endpoint's text columns |
| `sort` | endpoint default | one of the endpoint's allow-listed fields (generated as `*SortField` enums, for example `PropertySortField`); unknown values are 400 |
| `direction` | `asc` | `asc` or `desc` |

Endpoints add their own optional filters (for example `status` and `type` on `listProperties`).

Responses are pages: `{ items, total, page, pageSize }`. If the requested page starts after the last
row (for example because rows were deleted while paging), the API returns an **empty page with the
real `total`**, not an error, so the client can step back.

## Endpoints

From `backend/openapi.json`. "Writers" means `WRITER_ROLES`.

| Method and path | operationId | Scope | Roles |
| --- | --- | --- | --- |
| `GET /health` | `HealthController_liveness` | public | |
| `GET /health/ready` | `HealthController_readiness` | public | |
| `GET /api/v1/me` | `getMe` | bearer | |
| `GET /api/v1/companies` | `listCompanies` | bearer | |
| `GET /api/v1/companies/{companyId}` | `getCompany` | bearer | |
| `GET /api/v1/users` | `listCompanyUsers` | company | members |
| `GET /api/v1/properties` | `listProperties` | company | members |
| `GET /api/v1/properties/{propertyId}` | `getProperty` | company | members |
| `GET /api/v1/units` | `listUnits` | company | members |
| `GET /api/v1/units/{unitId}` | `getUnit` | company | members |
| `GET /api/v1/tenants` | `listTenants` | company | members |
| `GET /api/v1/tenants/{tenantId}` | `getTenant` | company | members |
| `GET /api/v1/leases` | `listLeases` | company | members |
| `GET /api/v1/leases/{leaseId}` | `getLease` | company | members |
| `POST /api/v1/leases/{leaseId}/verify` | `verifyLease` | company | writers |
| `GET /api/v1/statements` | `listStatements` | company | members |
| `POST /api/v1/statements/upload-url` | `createStatementUploadUrl` | company | writers |
| `POST /api/v1/statements` | `registerStatement` | company | writers |
| `GET /api/v1/statements/{statementId}` | `getStatement` | company | members |
| `GET /api/v1/statements/{statementId}/extraction` | `getStatementExtraction` | company | members |
| `POST /api/v1/statements/{statementId}/process` | `processStatement` | company | writers |
| `GET /api/v1/monitoring/events` | `listMonitoringEvents` | company | members |
| `GET /api/v1/monitoring/events/{eventId}` | `getMonitoringEvent` | company | members |
| `PATCH /api/v1/monitoring/events/{eventId}/status` | `updateMonitoringEventStatus` | company | writers |
| `GET /api/v1/arrangements` | `listArrangements` | company | members |
| `GET /api/v1/arrangements/{arrangementId}` | `getArrangement` | company | members |
| `GET /api/v1/communications` | `listCommunications` | company | members |
| `GET /api/v1/communications/approvals` | `listPendingApprovals` | company | members |
| `GET /api/v1/communications/{communicationId}` | `getCommunication` | company | members |
| `POST /api/v1/communications/{communicationId}/approve` | `approveCommunication` | company | writers |
| `POST /api/v1/communications/{communicationId}/reject` | `rejectCommunication` | company | writers |
| `GET /api/v1/notifications` | `listNotifications` | company | members (own notifications) |
| `POST /api/v1/notifications/read-all` | `markAllNotificationsRead` | company | members |
| `POST /api/v1/notifications/{notificationId}/read` | `markNotificationRead` | company | members |
| `GET /api/v1/audit-logs` | `listAuditLogs` | company | `AUDIT_READER_ROLES` |

Behaviour worth knowing:

- **Statement upload** is three calls: `createStatementUploadUrl` returns a signed upload URL into the
  `statements` bucket; the client uploads the PDF; `registerStatement` records it, runs duplicate
  detection (identical SHA-256 → 409; likely duplicate → registered with a warning) and enqueues
  `statement-processing`. `processStatement` re-queues extraction.
- **Monitoring status changes** follow the transitions in `@leaseguard/domain`; a disallowed move is
  409 and dismissing requires a `note` (the dismissal reason).
- **Approvals** (`approveCommunication`): any `company_admin` or `property_manager` may approve,
  including the person who requested the approval (single-manager companies must be able to send);
  `read_only` and `property_owner` get 403. The caller is recorded as the approver. The message must
  pass the same delivery gate the worker applies (422 listing every reason); a second decision is 409,
  and rejecting an approved message is 409. An approval on record that does not name its approver is
  refused (403). Approval enqueues `message-delivery`.

## Generating the contract and the client

After changing a controller, DTO or schema:

```sh
pnpm api:generate
```

This builds the backend, writes `backend/openapi.json` (`backend/src/generate-openapi.ts`, run with
`.env.example` values so no services are needed) and regenerates
`packages/api-client/src/generated/schema.ts` with openapi-typescript. Commit both files.

## Using the typed client

`@leaseguard/api-client` (`packages/api-client/src`) wraps openapi-fetch with the generated `paths`
types:

```ts
import { createApiClient, unwrap, isApiError, COMPANY_ID_HEADER } from '@leaseguard/api-client'

const api = createApiClient({
  baseUrl: 'http://127.0.0.1:3000',          // paths already include /api/v1
  getAccessToken: () => session?.access_token ?? null,
  getCompanyId: () => activeCompanyId,        // sent as X-Company-Id when set
  onUnauthorized: () => signOut(),            // called on every 401
})

const page = await unwrap(
  api.GET('/api/v1/properties', {
    params: { query: { page: 1, pageSize: 25, sort: 'name' } },
    headers: { [COMPANY_ID_HEADER]: companyId }, // optional explicit company per request
  }),
)
```

- `unwrap` resolves with the response body or rejects with `ApiError`.
- `ApiError` has `status`, `messages` (always an array), `requestId`, and helpers `isUnauthorized`,
  `isForbidden`, `isNotFound`, `isNetworkError` (status 0: the request never reached the API) and
  `isRetryable` (network, 429, 5xx).
- `compactQuery` drops empty query values; `pageCount` computes the number of pages from a `Page`.
- Generated schema types (for example `PropertyDto`, `PropertySortField`) are re-exported from the
  package root.

In the frontend, the single client instance is `getApiClient()` in `frontend/src/services/api/client.ts`.

## Not implemented yet

Checked against `backend/openapi.json` and `backend/src`:

- Create, update or archive endpoints for properties, units, tenants and leases (only lease
  verification exists).
- Statement review: confirming or correcting extracted figures, and statement verification.
- Creating or drafting outbound messages and templates; companies' WhatsApp settings.
- WhatsApp webhooks (delivery status, inbound replies).
- Request rate limiting.
