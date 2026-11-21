# API conventions

The LeaseGuard HTTP API is served by the core service (the NestJS process started by `backend/src/main.ts`) and,
for `/api/v1/reports`, by the reports service (`services/reports`, ADR 0003), both behind one gateway origin. This
page describes the conventions they share: every service implements them through `@leaseguard/service-kit`. The
authoritative contracts are the generated OpenAPI documents, `backend/openapi.json` and
`services/reports/openapi.json`; while a service runs, its Swagger UI is served at `/api/docs` and the JSON document
at `/api/docs-json` on that service.

The API never collects, processes or facilitates payments. Statement balances and payment
arrangements are monitoring records.

## Base path and versioning

- Business routes are under `/api/v1` (`API_PREFIX` in `packages/service-kit/src/openapi.ts`, re-exported by
  `backend/src/openapi.ts`). The gateway routes `/api/v1/reports` and below it to the reports service and every
  other path to the core (`infrastructure/gateway/routes.json`).
- Health probes stay at the root: `GET /health` (liveness) and `GET /health/ready` (readiness: 503
  until Redis answers and Supabase is reachable). They are the only `@Public()` routes.
- Every response carries an `X-Request-Id` header. A caller-supplied `X-Request-Id` (8–128 word
  characters or `-`) is reused; otherwise a UUID is generated.
- CORS allows only the origins in `API_CORS_ORIGINS` (`REPORTS_CORS_ORIGINS` on the reports service) and the headers `Authorization`, `Content-Type`,
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

Every failing request returns `ApiErrorBody` (`packages/service-kit/src/http/all-exceptions.filter.ts`,
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

From `backend/openapi.json` and, for the reports service, `services/reports/openapi.json`. "Writers" means
`WRITER_ROLES`.

### Reports service (`/api/v1/reports`)

| Method and path | operationId | Scope | Roles |
| --- | --- | --- | --- |
| `GET /api/v1/reports` | `listReports` | company | members |
| `GET /api/v1/reports/portfolio_overview` | `getPortfolioOverviewReport` | company | members |
| `GET /api/v1/reports/occupancy` | `getOccupancyReport` | company | members |
| `GET /api/v1/reports/arrears` | `getArrearsReport` | company | members |
| `GET /api/v1/reports/payment_arrangements` | `getPaymentArrangementsReport` | company | members |
| `GET /api/v1/reports/lease_expiry` | `getLeaseExpiryReport` | company | members |
| `GET /api/v1/reports/renewal_deadlines` | `getRenewalDeadlinesReport` | company | members |
| `GET /api/v1/reports/lease_monitoring` | `getLeaseMonitoringReport` | company | members |
| `GET /api/v1/reports/rental_discrepancies` | `getRentalDiscrepanciesReport` | company | members |

| `GET /api/v1/reports/deposits_guarantees` | `getDepositsGuaranteesReport` | company | members |
| `GET /api/v1/reports/statement_processing` | `getStatementProcessingReport` | company | members |
| `GET /api/v1/reports/communication_activity` | `getCommunicationActivityReport` | company | members |
`GET /api/v1/reports` returns `{ reports: ReportDefinitionDto[] }`: the report catalogue (`REPORT_CATALOGUE` in
`packages/domain/src/rules/reportCatalogue.ts`, the same list the web app shows), in display order. The service also
answers `GET /health` and `GET /health/ready` on its own port; through the gateway those paths reach the core.

**One endpoint pattern for every report** (ticket R-01): `GET /api/v1/reports/{reportId}`, read-only, open to every
member role of the active company (`X-Company-Id`), answering `{ reportId, asOf, filters, data }` (`ReportEnvelope` in
`packages/domain/src/types/reports.ts`): `asOf` is the South African date the figures are as at, `filters` the filters
actually applied, `data` the report (`ReportResultMap[reportId]`). The shared query is `propertyId` (repeat for several),
`from` and `to` (inclusive, `YYYY-MM-DD`, on the report's primary date) and `status` (repeat for several). A report
ignores filters it does not offer (`REPORT_FILTER_SUPPORT` in `packages/domain/src/rules/reportFrame.ts`) and answers 400
for a status it does not offer, a malformed id or date, or an unknown parameter; an unknown report id is 404. Every
figure is computed by the reports service from the `public.reports_*` functions under the caller's RLS (403 for another
company) and the domain rules; reports are monitoring summaries, never transactions.

- `portfolio_overview`: per property, units, occupied and vacant units, occupancy, active leases, monthly rental roll
  (current rental of the active leases with verified terms), outstanding (latest verified statement of each account at
  the property) with tenants in arrears, and open monitoring events; totals in the same response. Counted as
  `GET /dashboard/summary` counts: properties and units of properties that are not archived, occupied by occupancy
  status, active leases by status `active`, the outstanding total and tenants in arrears by the rules of
  `dashboard_arrears_totals`. An archived property is listed only while it still carries a balance or open events (or
  with `status=archived`), and its units are not in the totals. Status filter: the property status. No date range.
- `occupancy`: totals, by property and by unit type (occupied, vacant, under offer, unavailable, rate, floor areas), and
  every unit of a property that is not archived with its occupancy status and current tenant: the current lease's
  tenant, else the tenant assigned to it (`tenantSource` `lease` or `assignment`). Status filter: the occupancy status.
  No date range.
- `arrears` (R-05): every account in arrears, one row per tenant and unit (the lease when the statement names no unit),
  from its latest verified statement (`reports_arrears_accounts`, the rules of `GET /statements/arrears` and
  `dashboard_arrears_totals`; zero and credit balances are not arrears), largest first, aged from the statement date into
  the company's arrears monitoring buckets (`ageingBuckets`, default 30/60/90/120), linking to the tenant, unit, lease,
  statement and the arrangement in force. A tenant under an active payment arrangement stays in arrears (the balance is
  owed) and is marked on every unit (`underArrangement`), with whether the arrangement pauses its normal reminders
  (`remindersSuppressed`); totals: outstanding, tenants, tenants and outstanding under arrangement, reminders paused, and
  every bucket. Without filters the total and tenant count equal the dashboard's and the Statements page's. Status
  filter: `under_arrangement`, `no_arrangement`. No date range.
- `payment_arrangements` (R-05): every payment arrangement (active first, then proposed, defaulted, completed, cancelled;
  the latest agreed first), linking to the arrangement, unit and lease, with its schedule progress (instalments recorded
  as paid, `arrangementProgress`), missed instalments and, while it is in force, the overdue instalments (open past the
  due date plus the company's arrangement monitoring grace days, `graceDays`, as the arrangement monitoring counts them)
  and the next instalment; counts per status, the remaining balance under active arrangements, paid to date, missed and
  overdue totals. Records only: nothing is paid through LeaseGuard. Status filter: the arrangement status. Date range: the
  date agreed.
- `statement_processing` (R-06): every uploaded statement of the company (archived properties included, as the
  dashboard counts its pending reviews), newest first, linking to the statement, tenant and unit, with its South African
  upload date and age in days, source system, status, extraction confidence and, while under review, the fields a
  reviewer still has to confirm or correct (`fieldResolution`); counted by status, by source system and by property
  (in progress = uploaded or processing; waiting for review = `review_required`, processing failures included;
  processing failed = waiting with a processing error, `processingFailed`, as the Statements page shows it), with the
  review backlog oldest first and the processing failures with their reason. Without filters the statements waiting for
  review equal the dashboard's `pendingStatementReviews` and the Statements page's `status=review_required` total.
  Status filter: the statement status. Date range: the upload date (South African).
- `communication_activity` (R-06): every message of the company, newest first, with its counterparty (the tenant's
  trading name, the owner's name or the contact's WhatsApp name), its property (its own, else its lease's, statement's
  or arrangement's), status, delivery outcome (`pending`, `delivered`, `read`, `failed`: outbound messages handed to
  WhatsApp for sending only, as communication analytics counts them; delivered includes read) and its approval (the
  pending request, else the latest decided one); counted by type, status, outcome and property (messages without a
  property last), with the delivery rate, the messages awaiting approval longest waiting first with the hours each has
  waited and its age bucket (`under_1_day`, `1_3_days`, `3_7_days`, `over_7_days`), the mean approval turnaround of
  people's decisions (the AI agent's own approvals of its replies to contacts are left out) and the failed messages with
  their reason. Without filters the messages awaiting approval equal the dashboard's `pendingApprovals`. Read-only:
  nothing is sent, approved or retried from it. Status filter: the delivery status. Date range: the date the message
  was recorded (South African). The property filter leaves out messages without a property.
- `lease_monitoring` (R-02): every monitoring event of the company, the open ones by default (new, under review, action
  required, in progress: `OPEN_EVENT_STATUSES`, as the monitoring list and the dashboard count them), each with its age
  in days on the "as at" date (`ageBucket` 0-7, 8-30, 31-90, 90+) and whether it is overdue (open, due before the "as
  at" date), linking to the event, property, tenant and lease; counted by type, priority, status, property and age.
  Status filter: the event status. Date range: the date identified.
- `rental_discrepancies` (R-02): for every verified lease in a monitored status, the rental billed on its latest verified
  statement that bills rental against the escalated contractual rental at the billed period's start, with the
  difference (expected − billed, positive = billed short), the company's rental escalation discrepancy tolerance and the
  calculation step by step: the lease monitoring scan's comparison (`compareBilledRental`). A row links to the lease,
  the statement and the discrepancy event raised for that statement (`source` `event`, else `recomputed`); an open
  discrepancy event on an earlier statement is listed too (`current: false`) with the figures it recorded. Totals of the
  differences outside tolerance (net, under-billed, over-billed), the open discrepancy events (the dashboard's
  `escalationDiscrepancies` without filters), and the leases not compared (awaiting a verified statement, waiting for
  verification). Status filter: `outside_tolerance`, `within_tolerance`. Date range: the billed period's start.
- `lease_expiry` (R-03): every verified lease in a monitored status (active, expiring; unverified terms never drive
  monitoring, so those leases are only counted, `unverifiedLeasesExcluded`), soonest expiry first, with its days to
  expiry on the "as at" date and its bucket in calendar months (`expired`, `months_0_3`, `months_3_6`, `months_6_12`,
  `later`; each bucket's end inclusive, a month clamped to the target month's last day), rental, whether an unexercised
  renewal option exists, the company lease-expiry notice threshold reached (`noticeThreshold`, the one the lease
  monitoring scan raises its expiry event for, `shouldRaiseExpiryEvent`; the rule's own days, else the company's, none
  when the rule is off) and its open lease-expiry event; totals per bucket, expired, within notice. Status filter: the
  bucket. Date range: the expiry date.
- `renewal_deadlines` (R-03): every verified monitored lease with a renewal option and a notice period, soonest deadline
  first: the deadline (`renewalNoticeDeadline`: expiry less the notice period), days left, status
  (`renewalDeadlineStatus`: `passed`, `due_critical`, `due_soon`, `upcoming`, `open`, `exercised`), the company warning
  threshold reached (`warningThreshold`, the one the scan raises its renewal event for, `leasesRequiringRenewalWarning`)
  and its open renewal-notice-deadline event; counts per status, requiring a warning, options without a notice period.
  Status filter: the deadline status. Date range: the notice deadline.

- `deposits_guarantees` (R-04): every verified lease in a monitored status (active, expiring) with a deposit or a bank
  guarantee, by property then lease reference: the deposit held (and who holds it), the guarantee (bank, reference,
  amount, expiry), the rental the verified terms expect on the "as at" date (escalations applied), the required cover
  (basis months × that rental: `depositCoverage`, `guaranteeCoverage`, the figures of the lease monitoring scan's
  `deposit_shortfall` and `guarantee_shortfall` events; a deposit without a basis and a released or called guarantee
  have no required cover), the shortfall, and the guarantee's state (`guaranteeExpiryStatus`: `active`, `expiring` inside
  the guarantee expiry notice days, the rule's own else the company's, `expired`, `released`, `called`) with days to
  expiry; `needsAttention` marks a shortfall or an expiring or expired guarantee. Totals: deposits held, guarantees in
  force (active and expiring), deposit and guarantee shortfalls, leases short of cover, expiring and expired guarantees,
  the notice days used, and the unverified leases with a deposit or guarantee that are left out
  (`unverifiedLeasesExcluded`). Status filter: the guarantee state. Date range: the guarantee expiry date (either
  filter leaves out leases without a guarantee). Nothing claims or calls a guarantee.
### Core service

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
| `POST /api/v1/portfolio-imports/upload-url` | `createPortfolioImportUploadUrl` | company | writers |
| `POST /api/v1/portfolio-imports` | `createPortfolioImport` | company | writers |
| `POST /api/v1/portfolio-imports/google-sheets` | `createPortfolioImportFromGoogleSheet` | company | writers |
| `GET /api/v1/portfolio-imports` | `listPortfolioImports` | company | members |
| `GET /api/v1/portfolio-imports/{importId}` | `getPortfolioImport` | company | members |
| `POST /api/v1/portfolio-imports/{importId}/sheet` | `selectPortfolioImportSheet` | company | writers |
| `GET /api/v1/portfolio-imports/{importId}/mapping` | `getPortfolioImportMapping` | company | members |
| `PUT /api/v1/portfolio-imports/{importId}/mapping` | `savePortfolioImportMapping` | company | writers |
| `GET /api/v1/portfolio-imports/{importId}/preview` | `previewPortfolioImport` | company | members |
| `PATCH /api/v1/portfolio-imports/{importId}/rows/{rowNumber}` | `changePortfolioImportRow` | company | writers |
| `GET /api/v1/portfolio-imports/{importId}/summary` | `getPortfolioImportSummary` | company | members |
| `POST /api/v1/portfolio-imports/{importId}/approve` | `approvePortfolioImport` | company | writers |
| `GET /api/v1/units` | `listUnits` | company | members |
| `GET /api/v1/units/{unitId}` | `getUnit` | company | members |
| `POST /api/v1/units` | `createUnit` | company | writers |
| `PATCH /api/v1/units/{unitId}` | `updateUnit` | company | writers |
| `GET /api/v1/unit-assignments` | `listUnitAssignments` | company | members |
| `POST /api/v1/unit-assignments` | `assignTenantToUnit` | company | writers |
| `POST /api/v1/unit-assignments/{assignmentId}/end` | `endUnitAssignment` | company | writers |
| `GET /api/v1/message-templates` | `getMessageTemplateSettings` | company | members |
| `PUT /api/v1/message-templates/{messageType}` | `chooseMessageTemplate` | company | `company_admin` |
| `POST /api/v1/message-templates/sync` | `syncMessageTemplates` | company | `company_admin` |
| `GET /api/v1/tenants` | `listTenants` | company | members |
| `GET /api/v1/tenants/{tenantId}` | `getTenant` | company | members |
| `POST /api/v1/tenants` | `createTenant` | company | writers |
| `PATCH /api/v1/tenants/{tenantId}` | `updateTenant` | company | writers |
| `POST /api/v1/tenants/{tenantId}/whatsapp-validation` | `validateTenantWhatsAppNumber` | company | writers |
| `GET /api/v1/leases` | `listLeases` | company | members |
| `POST /api/v1/leases` | `createLease` | company | writers |
| `GET /api/v1/leases/{leaseId}` | `getLease` | company | members |
| `PATCH /api/v1/leases/{leaseId}` | `updateLease` | company | writers |
| `POST /api/v1/leases/{leaseId}/verify` | `verifyLease` | company | writers |
| `GET /api/v1/leases/{leaseId}/documents` | `listLeaseDocuments` | company | members |
| `GET /api/v1/statements` | `listStatements` | company | members |
| `GET /api/v1/statements/arrears` | `getStatementArrears` | company | members |
| `POST /api/v1/statements/upload-url` | `createStatementUploadUrl` | company | writers |
| `POST /api/v1/statements` | `registerStatement` | company | writers |
| `GET /api/v1/statements/{statementId}` | `getStatement` | company | members |
| `GET /api/v1/statements/{statementId}/extraction` | `getStatementExtraction` | company | members |
| `POST /api/v1/statements/{statementId}/process` | `processStatement` | company | writers |
| `GET /api/v1/statements/{statementId}/download-url` | `getStatementDownloadUrl` | company | members |
| `PUT /api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction` | `correctStatementField` | company | writers |
| `POST /api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm` | `confirmStatementField` | company | writers |
| `PUT /api/v1/statements/{statementId}/match` | `setStatementMatch` | company | writers |
| `POST /api/v1/statements/verify` | `verifyStatements` | company | writers |
| `POST /api/v1/statements/{statementId}/verify` | `verifyStatement` | company | writers |
| `POST /api/v1/statements/{statementId}/reject` | `rejectStatement` | company | writers |
| `POST /api/v1/statements/{statementId}/mark-duplicate` | `markStatementDuplicate` | company | writers |
| `GET /api/v1/dashboard/summary` | `getDashboardSummary` | company | members |
| `GET /api/v1/monitoring/events` | `listMonitoringEvents` | company | members |
| `GET /api/v1/monitoring/events/{eventId}` | `getMonitoringEvent` | company | members |
| `PATCH /api/v1/monitoring/events/{eventId}/status` | `updateMonitoringEventStatus` | company | writers |
| `GET /api/v1/arrangements` | `listArrangements` | company | members |
| `GET /api/v1/arrangements/{arrangementId}` | `getArrangement` | company | members |
| `POST /api/v1/arrangements` | `createArrangement` | company | writers |
| `PATCH /api/v1/arrangements/{arrangementId}` | `updateArrangement` | company | writers |
| `POST /api/v1/arrangements/{arrangementId}/close` | `closeArrangement` | company | writers |
| `POST /api/v1/arrangements/{arrangementId}/cancel` | `cancelArrangement` | company | writers |
| `POST /api/v1/arrangements/{arrangementId}/installments/{installmentId}/outcome` | `recordInstallmentOutcome` | company | writers |
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

- **Unit list** (`listUnits`): each item is a `UnitListItem`: the unit with its `property`
  (`id`, `name`, `code`), its `currentTenant` (`id`, `tradingName`: the current lease's tenant, else the tenant
  assigned to it without a lease), while it has a current lease `currentLease` (`id`, `reference`,
  `commencementDate`, `expiryDate`), and while it is assigned `currentAssignment` (`id`, `tenantId`, `tenantName`,
  `assignedAt`), read from `currentTenantId` / `currentLeaseId` and the unit's current assignment through the
  company-scoped foreign keys (RLS applies to every embedded row). Filters: `propertyId`, `type`, `occupancyStatus`;
  `search` matches the unit number. `getUnit` returns the `Unit` with its `currentAssignment`.
- **Unit writes** (`createUnit`, `updateUnit`): unit number (trimmed, unique within its property: 409
  `A unit numbered … already exists in this property`), property (create only; fixed afterwards), unit type, floor
  area (m², two decimals), optional floor and description, occupancy status (`vacant` when omitted on create). The
  current tenant and lease are derived from the active lease and are refused in a body (400). A property outside the
  company is 422 (`Choose a property in this workspace`); the units of an archived property are read-only and none is
  added to it (422); a unit with a current lease stays `occupied` (422). The database audits every create and change,
  and summarises an occupancy change as `Unit G12 in Mall Square changed from vacant to under offer`.
- **Tenant writes** (`createTenant`, `updateTenant`): registered name (required) and trading name (the registered
  name when omitted), business type, optional registration and VAT numbers, contact person (`primaryContact`: name
  required on create; role; phone, the WhatsApp number when omitted; email), WhatsApp number, email, status
  (`prospective` when omitted), industry and notes. On `PATCH`, omitted fields (and omitted contact fields) are
  unchanged and empty or null clears an optional one. The WhatsApp number may be typed as people write it
  (`082 123 4567`, `+27 82 123 4567`) and is stored in E.164 (`normalizeWhatsAppNumber` in `@leaseguard/domain`); an
  invalid number is 400 with the format to use (`whatsappNumber: Enter the WhatsApp number with its country code, for
  example +27 82 123 4567`). A new tenant's number starts unvalidated and a different number is unvalidated again
  (the database resets `whatsappVerified` in the same write), so automated communication stays off until it is
  validated (PRD §5.4). `whatsappVerified`, `whatsappOptedOut` and `companyId` are refused in a body (400). The
  database audits every create and change; a number change is summarised as `Tenant <trading name>: WhatsApp number changed; it
  must be validated again`, with the old and new number.
- **WhatsApp number validation** (`validateTenantWhatsAppNumber`, ticket M4-03): a writer records that they confirmed
  the number with the tenant. The body is `{ whatsappNumber }`, the number they checked (typed or E.164); it must still
  be the number on record, so a number changed in the meantime is 409 and is never validated by mistake. The database
  function `validate_tenant_whatsapp_number` sets `whatsappVerified`, stamps `whatsappValidatedAt` and
  `whatsappValidatedByUserId` (shown as the sign-off on the tenant page), and audits it as `verify` (`Tenant <trading
  name>: WhatsApp number <number> validated`). Validating a validated number returns the tenant unchanged; read-only
  members and owners are 403, another company's tenant is 404. A later change of number clears all three again.
- **Tenant list** (`listTenants`): each item is a `TenantListItem`: the tenant with its `leaseCount` and
  `currentLease` (`leaseId`, `reference`, `status`, `verified`, `unitId`, `unitNumber`, `propertyId`,
  `propertyName`), embedded through `leases_tenant_fk`, `leases_unit_fk` and `leases_property_fk` under the caller's
  RLS. The current lease is chosen by `currentLease` in `@leaseguard/domain` (in force, then being set up, then
  ended; latest commencement among equals). Filters: `status`, `businessType`, `propertyId` (tenants with a lease in
  that property; the embedded leases and `leaseCount` are then limited to it); `search` matches the registered and
  trading names and the contact person. Each item also lists `currentUnits` (`unitId`, `unitNumber`, `propertyId`,
  `propertyName`): the units whose current tenant it is, by lease or assignment (`units_current_tenant_fk`). `getTenant`
  returns the plain `Tenant`.
- **Message templates** (`getMessageTemplateSettings`, `chooseMessageTemplate`, `syncMessageTemplates`; ticket SG-01): every member reads the seven templated message types (the five tenant statement and payment types, then the owner types) with `audience`, the chosen template (`mapping`: Meta name, language, category, text, variables, `approvalStatus`, Meta's `metaStatus` and `rejectedReason`, `supportsDocumentAttachment`, `metaBodyChanged`, who chose it and when) and `sendable` (`messageTypeTemplateState` in @leaseguard/domain: chosen, approved by Meta and its text unchanged), plus `whatsappConnected`. A company admin chooses a synced template for a type (`{ whatsappTemplateId }`): the API checks `templateMappingProblems` first and answers 422 with every reason (not approved, authentication, a tenant type needs Utility, no text, named or gapped placeholders, banking details, forbidden tenant topics); the database checks again and refuses a template already sending another type (422 in its words); another company's template is 404, an untemplated type 400, anyone but a company admin 403. Choosing is audited. `syncMessageTemplates` queues `whatsapp-template-sync` for one connected number per WhatsApp Business Account (202 `{ queued, message }`; 409 without a connected number, 503 without Redis); the API never calls Meta. `listWhatsAppMessageTemplates` items also carry Meta's `body` and `headerFormat`.
- **Unit assignments** (`listUnitAssignments`, `assignTenantToUnit`, `endUnitAssignment`; ticket M4-04): a writer
  assigns a tenant to a unit without a lease (`{ tenantId, unitId }`); the unit is occupied by that tenant straight
  away. A tenant may hold several units; a unit has one current tenant. The database refuses, and the API answers 409
  with its words: a unit assigned to another tenant (`Unit S02 is assigned to … Unassign it before …`), a unit let to
  another tenant (`Unit S01 is let to … under lease …`), an archived property, an assignment already ended; a tenant
  or unit of another company is 404. Assigning the holder again returns the current assignment. Ending an assignment
  keeps it as history (`current=false` lists ended ones) and returns the unit to vacant unless a lease keeps it
  occupied. A lease of an assigned unit must be for the assigned tenant (`createLease`/`updateLease` answer 422 in
  words). Assign and unassign are audited on the unit. An assignment never drives monitoring or tenant messages; the
  statement worker only uses the assigned tenants of a statement's property as matching hints. Lists are newest
  first; filters `tenantId`, `unitId`, `propertyId`, `current`.

- **Lease list** (`listLeases`): each item is a `LeaseListItem`: the `Lease` plus `tenantName` (trading name),
  `propertyName` and `unitNumber`, embedded through `leases_tenant_fk`, `leases_property_fk` and `leases_unit_fk` under
  the caller's RLS. Filters: `status`, `propertyId`, `unitId`, `tenantId`, `verified`, and `expiresWithinDays` (0 to
  3650: expiry from today, the South African date, to that many days ahead, inclusive; `expiringWithinRange` in
  `@leaseguard/domain`). `search` matches the reference or the tenant's trading or legal name, through the
  `tenant_search_text` computed field (a SECURITY INVOKER function of the lease row). `getLease` returns the plain
  `Lease`.
- **Lease verification** (`verifyLease`): writes only `verified` (and the status `leaseStatusAfterVerification` gives);
  the database stamps `verified_by_user_id` and `verified_at` and writes the audit entry. Idempotent.
- **Lease documents** (`listLeaseDocuments`): the `LeaseDocument` records of one lease (type, title, stored file,
  uploader, upload time), newest first, at most 200; 404 when the lease is not in the active company.
- **Lease document upload** (M5-02) is three calls, writers only: `createLeaseDocumentUploadUrl`
  (`POST /leases/{leaseId}/documents/upload-url`, `{ fileName, mimeType: 'application/pdf', sizeBytes }`) returns a
  one-time signed upload URL into the private `lease-documents` bucket at `<companyId>/<documentId>/<safe file name>`
  (413 above 20 MB, `LEASE_DOCUMENT_MAX_BYTES`; 400 for anything but a PDF; 404 for a lease not in the company); the
  client uploads the PDF with `Content-Type: application/pdf`; `registerLeaseDocument` (`POST /leases/{leaseId}/documents`,
  `{ storagePath, fileName, mimeType, sizeBytes, documentType, title }`) records it (201 `LeaseDocument`). The API reads
  the stored object back: it must exist, match `sizeBytes`, be stored as a PDF and start with the `%PDF-` header (422
  otherwise); the SHA-256 is computed from the stored bytes. A path already recorded is 409. The database stamps the
  uploader from `auth.uid()` and writes the `upload` audit entry. Recorded documents and their files are kept (no
  update or delete).
- **Lease document download** (`getLeaseDocumentDownloadUrl`, `GET /leases/{leaseId}/documents/{documentId}/download-url`):
  `{ url, expiresInSeconds: 300 }`, a five-minute signed link for any member; 404 when the document is not on that
  lease of the active company.

- **Statement upload** is three calls: `createStatementUploadUrl` returns a signed upload URL into the
  `statements` bucket; the client uploads the PDF; `registerStatement` reads the stored file back (size,
  `%PDF-` header and SHA-256 must match, 422 otherwise), records it, runs duplicate
  detection (identical SHA-256 → 409 naming the statement on record, and the copy just uploaded is removed from the
  bucket unless a statement already points at that path; likely duplicate → registered with a warning) and enqueues
  `statement-processing`. A new statement is always `uploaded`: the database stamps the uploader and time from the
  session and audits each registration as an `upload` (property, file, source system, SHA-256, `uploadBatchId`).
  The upload screen (ticket S-03) sends many files as one batch: it gives every file the same `uploadBatchId`,
  uploads a file repeated within the batch once (domain `repeatsWithinBatch`) and checks each file is a non-empty PDF
  within the limit by its content before signing (domain `statementFileProblem`). `statementDate`, `periodStart`/`periodEnd` (both or neither) and `statementNumber`
  are optional: they are read from the document, and a typed value the document disagrees with is flagged at
  review, never replaced. Until verified, a `StatementDto` may have no `statementDate` or period; a
  verified one always has them. A likely duplicate (same tenant, period and statement number, two missing numbers
  counting as equal since many statements print none) needs a known period, so an untyped upload is checked
  by file hash only; statements known to be for different units or leases of the tenant are never likely duplicates. `processStatement` re-queues extraction; a statement whose extraction failed
  (`review_required` with `processingError`) goes back to `uploaded` with the error cleared and is queued again
  through the database function `retry_statement_processing` (writer check; the status change is audited; a signed-in
  caller has no direct UPDATE of a statement's status or processing error). If the queue is down the statement stays
  `uploaded`, like a registration the queue missed, and `processStatement` queues it later.
- **Statement list** (`listStatements`): each row is a `StatementListItemDto`, the statement plus `propertyName` and,
  once matched, `tenantName` and `unitNumber`. Filters `status`, `propertyId`, `tenantId`, `leaseId`, `sourceSystem`,
  `uploadBatchId` (one upload batch);
  `search` matches the file name and statement number. Figures are present only on verified statements.
  `readyToVerify` is true when the statement is under review with nothing unresolved (every field resolved, the tenant,
  unit and lease set, the lease in force: `statementVerificationProblems` finds nothing), worked out for the page's
  matched statements under review in one query per table.
- **Statement review** (ticket S-04): `getStatementDownloadUrl` signs a five-minute link to the original file for any
  member. `getStatementExtraction` lists every field with its `resolution` (`fieldResolution` in the domain): `accepted`
  (found without a flag), `confirmed` or `corrected` by a reviewer, or `unresolved` (flagged or missing). A writer resolves
  a field with `correctStatementField` (`{ value }`: text for names and numbers, `YYYY-MM-DD` for dates, rands with at
  most two decimals for amounts, checked by `parseFieldCorrection`; 422 otherwise) or `confirmStatementField` (the
  extracted value is right; 422 for a value that was not found, which can only be entered). Many statements print no
  number: `confirmStatementFieldNotOnStatement` (`POST .../extraction/fields/statement_number/not-on-statement`) records
  that the statement number is not on the statement, resolving the field with no value (`resolution` `confirmed`,
  `value` null; domain `confirmedNotOnStatement`); nothing is filled in and the verified statement has no
  `statementNumber`. Only `statement_number` may be left out (`OPTIONAL_EXTRACTION_FIELDS`; 422 for any other field) and
  only when the extractor found no value (422: confirm or correct it). It is stamped and audited like any confirmation,
  drops a correction, and confirming it again changes nothing. A correction replaces a
  confirmation and confirming drops a correction; the extracted value is always kept. The database stamps who and when
  and audits each change with before and after. `setStatementMatch` (`{ tenantId, unitId, leaseId? }`) sets the three
  together: the extraction's `matchedTenantId`/`matchedUnitId` is only a proposal and is never applied by itself; the
  unit must be on the statement's property; without `leaseId` the tenant's lease of the unit in force on the statement
  date (the reviewed `statement_date` field, else the date typed at upload) is used, and an unknown date, no lease or
  overlapping leases are refused with the reason; a chosen lease must be that tenant's lease of that unit and in force on
  the date. Every problem is listed in one 422. All three writes answer 409 unless the statement is `review_required`
  and its extraction `pending_review`.
- **Statement outcome** (ticket S-05): `verifyStatement` is allowed once every field is resolved (the statement number
  may instead be confirmed as not on the statement) and the tenant, unit and lease are set, the reviewed period does not
  end before it starts, and the lease was in force on the reviewed statement date (domain
  `statementVerificationProblems`; 422 listing every reason otherwise, 409 unless `review_required`). The database
  function repeats the period and lease checks, so a direct call cannot skip them. The database function `verify_statement` writes the reviewed
  values (the correction, else the extracted value) onto the statement: number, date, period and the six figures
  (`outstanding_balance` becomes `closingBalance`); the client never sends figures, and this is the only way they reach a
  statement. It stamps the verifier, closes the extraction (`confirmed`, or `corrected` when any value was entered) and
  resolves the statement's `statement_review_required` event. The response is `StatementVerificationResultDto`
  (`{ statement, monitoringQueued }`): the API queues `statement-monitoring`, which runs arrears and lease (escalation)
  monitoring for that tenant at once; `monitoringQueued` is false when the queue was down (the daily run covers it).
  `rejectStatement` (`{ reason }`, 1 to 1000 characters, kept as `rejectionReason`) and `markStatementDuplicate`
  (`{ duplicateOfStatementId }`: another statement of the company that is not rejected or a duplicate, 422 otherwise)
  close the extraction as `rejected` and resolve the review event. Every outcome is audited (`verify`, or `reject` for
  rejected and duplicate).
- **Verifying several statements** (ticket S-07): `verifyStatements` (`{ statementIds }`, 1 to 100 distinct ids) verifies
  each statement in the order given exactly as `verifyStatement` does: its own checks, its own `verify_statement` call
  (so its own audit entry and closed review event) and its own `statement-monitoring` job. A refusal never undoes the
  others. It answers 200 with `StatementsVerificationResultDto`: `verified` (`statementId`, `fileName`,
  `statementNumber?`, `monitoringQueued`) and `notVerified` (`statementId`, `fileName?` (absent when the statement is
  not in the company), `statementNumber?`, `reasons`: every reason, as `verifyStatement` would answer).
- **Payment arrangements** (`createArrangement`, `updateArrangement`, `closeArrangement`, `cancelArrangement`,
  `recordInstallmentOutcome`; ticket M7-03): monitoring records of an agreement; nothing collects, processes or
  verifies a payment. `createArrangement` takes the tenant, the property, optionally the unit and lease (else the
  tenant's single lease in force at the property), the outstanding balance, instalment amount and frequency, the first
  instalment date, optionally the final instalment date (it must be the schedule's last due date), `status`
  (`proposed` or `active`, default `active`), `agreedOn` (default today) and notes. The database generates the
  instalments (`generateInstallmentSchedule`'s schedule) and checks the terms (`arrangementTermsProblems`'s words):
  422 when they do not fit or the lease is not the tenant's at the property; 409 when the tenant already has an active
  arrangement (one per tenant). `updateArrangement` edits a proposed or active one (omitted fields unchanged; status
  proposed -> active only); changed terms regenerate the schedule, refused with 409 once an instalment outcome is
  recorded. `closeArrangement` (`completed` or `defaulted`, an active one) and `cancelArrangement` (a reason required;
  proposed or active) stamp `closedOn`, `closedByUserId` and `closeReason`; a closed arrangement answers 409 to every
  write. `recordInstallmentOutcome` records what the property manager confirms (`confirmed_paid`, `missed`, `waived`;
  `scheduled` clears it) on an active arrangement; a future instalment cannot be missed; it stamps
  `outcomeRecordedByUserId` and `outcomeRecordedAt` (and `confirmedByUserId`/`confirmedOn` when paid). Every write
  returns the arrangement with its instalments and is audited on it. While active, an arrangement keeps suppressing
  the tenant's normal arrears reminders (`suppressArrearsReminders`); closing or cancelling resumes them. The daily
  `arrangement-reminders` job raises `arrangement_attention` events for overdue instalments and for instalments a
  verified statement of the lease shows were not covered (`installmentShortfallsOnStatements`: payments received below
  that period's charges plus the instalments due), naming the statement with the calculation; never a tenant message.
  `listArrangements` also filters by `propertyId`. Every arrangement response (list, get and each write) also names
  its tenant (`tenantName`), property (`propertyName`), unit (`unitNumber`) and lease (`leaseReference`)
  (`PaymentArrangementListItem`, to-one embeds over the composite foreign keys; ticket M7-04).
- **Statement arrears** (`getStatementArrears`): the Statements page's figures, calculated by the domain
  `arrearsOverview` from the LATEST verified statement of each tenant's lease (a tenant with several leases or units has
  a statement per lease, and every one counts; a renewal that replaces the lease of the same unit supersedes the
  replaced lease's last statement, whose balance it carries forward, so it is not counted twice; statements in review
  never count): `totalOutstanding` (across every
  tenant and lease), `tenantsInArrears` and `tenantsUnderArrangement` (distinct tenants), one entry per bucket of the
  company's arrears monitoring rule (`ageingBucketsDays`, default 30/60/90/120; every bucket listed, zero when empty;
  `tenantCount` distinct tenants), `pendingReview` (statements in `review_required`) and `entries`: one per tenant and
  lease in arrears with the statement its balance comes from, its age and bucket
  (aged from the statement date to today in South Africa, `asOf`), who verified it, and whether an active payment
  arrangement is in force for the tenant (`underArrangement`, on every lease of the tenant) and pauses reminders
  (`remindersSuppressed`). The minimum-balance threshold
  of the arrears rule decides when an event is raised, not what is owed, so it does not filter these figures.
- **Dashboard summary** (`getDashboardSummary`, ticket M7-05): every PRD §7.1 figure of the active company in one
  request, as the domain `DashboardSummary`: `properties` (not archived), `units` and `occupiedUnits` (units of those
  properties; occupied is the unit's `occupancy_status`, which a current lease or an assigned tenant keeps occupied),
  `activeLeases` (status `active`), `totalOutstanding`, `tenantsInArrears` and `pendingStatementReviews` (the statement
  arrears figures above, worked out in one database query, `dashboard_arrears_totals`, with the same rules: the latest
  verified statement per unit, an arrangement never taking a balance out; the dashboard never loads the statements, and
  it and the Statements page never disagree; `asOf` is the South African day),
  `activeArrangements` (status `active`), `pendingApprovals` (approval requests with decision `pending`) and the OPEN
  monitoring events (`OPEN_EVENT_STATUSES`) of one type each (`DASHBOARD_EVENT_FIGURES`): `escalationDiscrepancies`,
  `upcomingExpiries`, `renewalDeadlines`, `expiringGuarantees`. The counts are head-only parallel queries on indexed
  columns through the caller's client. Monitoring figures, never transactions.
- **Portfolio import** (upload a portfolio file) is three calls: `createPortfolioImportUploadUrl` returns a
  signed upload URL into the private `portfolio-imports` bucket and the `contentType` to send; the client
  uploads the CSV or XLSX file; `createPortfolioImport` (`scope` `properties`, or `units` with a
  `propertyId` that is not archived) has the API download and read it: CSV comma or semicolon separated,
  UTF-8 with or without a byte-order mark; XLSX from the first visible sheet unless `sheetName` names
  another. Empty rows are ignored and the first non-empty row holds the column headings. Over 5 MB is
  413; an empty file, headings only, over 5000 rows or 100 columns, text that is not UTF-8, an `.xls` or
  password-protected workbook, or no such sheet is 422 with a message saying what to do. The batch and
  its rows are stored in one transaction (`create_portfolio_import`); nothing is written to properties
  or units. `selectPortfolioImportSheet` reads the stored workbook again from another sheet.
- **Portfolio import from a Google Sheets link** (`createPortfolioImportFromGoogleSheet`, ticket I-06): the
  body is `scope`, `propertyId` (for units) and `url`. Only a `docs.google.com/spreadsheets/d/<id>` link is
  accepted (400 otherwise); the API takes the spreadsheet id and the tab (`gid`, else the first tab) from it
  and fetches only the CSV export address it builds itself, following redirects by hand to Google's
  download hosts (`*.googleusercontent.com`) over HTTPS, at most three, within 20 seconds and 5 MB. A
  sheet not shared with "Anyone with the link" (sign-in redirect, 401/403, an HTML sign-in page) is 422
  with the steps to share it; a deleted sheet or tab is 422; over 5 MB is 413; Google too slow is 504,
  unreachable 502. What was read is stored in the `portfolio-imports` bucket as the batch's CSV file (the
  name Google gives the export) and then read as an uploaded CSV is; the batch carries `googleSheet`
  (`spreadsheetId`, `gid`).
- **Portfolio import column mapping and preview** (ticket I-02). `getPortfolioImportMapping` returns every
  field of the batch's scope with the file column read for it and the column suggested from the headings.
  `source` says where the mapping came from: `applied` (applied to this batch), `saved` (the company's last
  mapping for a file with the same headings and scope, matched on a SHA-256 of the trimmed, lower-cased
  headings) or `suggested` (from the headings only, never the values: `@leaseguard/domain`
  `suggestPortfolioImportMapping`, which knows LeaseGuard's template headings and the usual MRI, MDA,
  PropSys and Sage export headings). `savePortfolioImportMapping` (body `{ mapping: { <field>: <column> } }`)
  applies it to the batch and saves it for the headings in one transaction (`save_portfolio_import_mapping`);
  a column the file lacks, a column chosen twice or a property field on a units batch is 422. Reading another
  sheet clears the applied mapping. `previewPortfolioImport` (`result`, `page`, `pageSize` ≤ 100) checks every
  row on each request: cells are read (labels such as "Line shop", provinces by name or abbreviation, South
  African number notation; `12,500` is refused as unclear) and held to the property and unit create rules;
  a property is found by its code, then by name with street address and postal code (case and spacing
  ignored, never a similar name), a unit by its number within the property. Results: `new`, `match`,
  `conflict` (with both values per field, or the earlier row's), `invalid` (with the reasons) and
  `duplicate` (an earlier row names the same records). `counts` covers the whole batch. Nothing is written.
- **Portfolio import row fixes** (ticket I-03). `changePortfolioImportRow` (writers) takes any of
  `corrections` (merged by field: a value is read instead of the file's cell, `""` clears it, `null` reads the
  file's cell again; a property field on a units batch is 422), `skipped` (leave the row out, or include it
  again) and `link` (`{ propertyId?, unitId? }`, or `null` to unlink): the row stands for that existing
  property and unit, so nothing new is created for them and the file's values for them are neither
  validated nor compared. In a properties batch a unit alone implies its property; a units batch links only
  units of its property (422 otherwise, also for a record not in the workspace). Changes are stored on
  `portfolio_import_rows`, never on properties or units. The first correction on a batch still read with a
  saved or suggested mapping applies that mapping (as `savePortfolioImportMapping` would), so the audit's
  previous value is the cell the manager saw. The answer is the row checked again; the preview's rows carry
  `resolution` (corrections with the file's value, skipped, linked records, `changedByUserId`, `changedAt`)
  and the result `skipped`. The database stamps who changed the row and audits each previous and new value.
  `listPortfolioImports` (`scope`, `propertyId`, `page`, `pageSize`) is the import history, newest first, from
  which a batch left with unresolved rows is resumed.
- **Portfolio import approval** (ticket I-04). `getPortfolioImportSummary` checks the rows as the preview does
  and returns what approving creates now (`propertiesToCreate`, `unitsToCreate`), `linkedRows` (`match`),
  `skippedRows`, `blockedRows` (`invalid`, `conflict`, `duplicate`: left out until fixed), `canApprove`,
  `needsAccountingSystem`, the last `approval` (`approvedByUserId`, `approvedAt`) and every record the import
  created (`created`: property or unit, its id, label, property and row). `approvePortfolioImport` (writers;
  body `{ accountingSystem? }`, required when properties are created: 422 otherwise) builds each new
  property and unit with the property and unit forms' create schemas and insert columns
  (`propertyInsertColumns`, `unitInsertColumns`; the approver is the new properties' manager) and creates
  them all in one transaction (`apply_portfolio_import`): all land or none do, through the same grants,
  RLS, guards and audit triggers as the forms (an archived property is 422). When nothing is left to create
  the summary is returned unchanged, so approving twice or importing the same file again never creates a
  duplicate; a record added meanwhile by another approval (23505) is checked again once, then 409. The
  answer is the summary after the approval. Importing never enables or sends tenant messaging.
- **Tenants from the register** (ticket I-05). A file may also have tenant columns (`tenantTradingName`,
  `tenantLegalName`, `tenantRegistrationNumber`, `tenantAccountReference`, `tenantBusinessType`,
  `tenantContactPerson`, `tenantEmail`, `tenantPhone`; suggested from register headings such as Tenant, Reg No,
  Account No, Occupant ID, Contact person, Cell), read for the row's unit. Each preview row then carries
  `tenant`: `result` `new`, `match` (`matchedBy` `registrationNumber`, `accountReference`, `confirmed` or
  `createdByImport`), `suggested` (tenants with a similar name in `suggestions`; the row's result is then
  `suggested`, blocked until decided), `conflict` or `invalid`, with `reasons`, `sameAsRowNumber` (a tenant
  several rows name by its identifier is created once) and `missingContactDetails`. Only an exact
  registration number or account reference (spaces and case ignored) matches; similar names never do. Values
  are held to the tenant form's rules (South African phone numbers only, valid emails); a new tenant needs its
  registered name, contact person, phone and business type (or a CIPC registration number that states it).
  `changePortfolioImportRow` also takes `tenantMatch`: `{ decision: 'confirmed', tenantId }` (a tenant of the
  workspace, 422 otherwise), `{ decision: 'rejected' }` (a new tenant is created), or `null` to withdraw. The
  summary adds `tenantsToCreate`, `tenantsLinked`, `tenantSuggestionsToReview` and `missingContactDetails`
  (`rowNumber`, `tenantName`, `missing`, `blocksCreation`); approving builds each tenant with the tenant
  form's create schema and `tenantInsertFrom` and creates it with the batch (`created` lists it as `tenant`
  with its `unitId` and `unitNumber`). A created tenant's WhatsApp number starts unvalidated and nothing is
  sent. `createTenant` / `updateTenant` take `accountReference` (unique per company, 409 on a duplicate).
- **Monitoring list** (`listMonitoringEvents`, ticket M7-01): filters `status` or `open` (true: new, under review,
  action required, in progress; false: resolved or dismissed), `priority`, `type`, `propertyId`, `unitId`,
  `tenantId`, `leaseId`, `arrangementId` (events about one payment arrangement), `assignee` (a member's user id, or `unassigned`) and `due` (`overdue`: due before today;
  `next_7_days` / `next_30_days` / `next_90_days`: due from today to n days from today, inclusive; judged on the
  South African date by `dueWindowRange` in `@leaseguard/domain`); search on title, description and lease reference;
  sort by `identifiedOn`, `dueDate` (events without one last), `priority` or `createdAt`. Each item is a
  `MonitoringEventListItem`: the event plus `propertyName` and, when set, `unitNumber`, `tenantName` (trading name)
  and `assigneeName` (the member's full name), read from the database with the event.
- **Monitoring event detail** (`getMonitoringEvent`, ticket M7-02) answers the same `MonitoringEventListItem` as a list
  row (the event with its calculation, plus the property, unit, tenant and assignee names), and so does a status change.
- **Where an event came from**: every lease finding (escalation discrepancy, expiry, renewal deadline, guarantee expiry
  and shortfall, deposit shortfall) and every arrears event carries `leaseId` and `leaseReference` with its property,
  unit and tenant; escalation discrepancies and arrears events also carry the verified `statementId` they were read
  from, and money findings the `calculation` (expected, actual, difference and each step). Arrears events record the
  lease reference since ticket M7-06, so the list's lease-reference search finds them too (`tests/README.md`,
  "Monitoring accuracy acceptance").
- **Monitoring status changes** follow the transitions in `@leaseguard/domain` (`nextEventStatuses`, `canTransition`),
  enforced by the database: the API calls `update_monitoring_event_status` (migration
  `20261122010000_monitoring_event_status_workflow.sql`), which locks the event and checks the move from its current
  status, and signed-in users cannot update `monitoring_events` through the Data API at all. A disallowed move
  (including one from a status someone else changed meanwhile, or any move of a resolved or dismissed event) is 409 with
  the database's words, and dismissing requires a `note`
  (the dismissal reason, `statusChangeRequiresNote`); on other moves the note is stored as the resolution notes. An
  event's history is its audit log: `listAuditLogs` with `entityType=monitoring_event&entityId=…` (audit readers;
  property owners 403). Each entry carries the status change and, when the same move changed them, the
  `resolution_notes` and `dismissal_reason` (migration `20261122003000_monitoring_event_status_history.sql`).
- **Approvals** (`approveCommunication`): any `company_admin` or `property_manager` may approve,
  including the person who requested the approval (single-manager companies must be able to send);
  `read_only` and `property_owner` get 403. The caller is recorded as the approver. The message must
  pass the same delivery gate the worker applies (422 listing every reason); a second decision is 409,
  and rejecting an approved message is 409. An approval on record that does not name its approver is
  refused (403). Approval enqueues `message-delivery`.

- **Lease create and edit** (`createLease`, `updateLease`, ticket M5-01): every PRD §5.5 field: reference, tenant,
  property and unit, commencement and expiry, initial and current monthly rental (ZAR excl. VAT; current defaults to
  initial), payment due day (1–28), `escalation` (type with the amount it names, frequency, first escalation date),
  `renewalOption` (`exists`, `renewalTermMonths`, `noticePeriodMonths`, `notes`; exercising it is separate), `deposit`
  and `bankGuarantee` (bank, reference, amount, basis months, issue and expiry dates; its status is not set here). On
  `PATCH` omitted fields are unchanged, each group replaces the whole group and `null` removes the deposit or the
  guarantee. A new lease is unverified (`pending_verification`, or `draft`). The reference is upper-cased and unique in
  the company (409 `A lease with the reference … already exists in this workspace`); the tenant, property and unit must
  belong to the company and the unit to the property, and the property must not be archived (422 in words, from
  `private.guard_lease_change`); the parties cannot change once statements, arrangements, monitoring events or messages
  name the lease (422). Both write through `public.save_lease` (SECURITY INVOKER: lease and guarantee in one
  transaction, under the caller's RLS). **A change to a term of a verified lease returns it to pending verification**
  (verified off, verifier and time cleared, active or expiring → `pending_verification`), whoever writes it, and is
  audited as `Lease <ref> terms changed; verification reset`; a signed-in user's guarantee change does the same. The
  terms are listed in `LEASE_TERM_GROUPS` / `changedLeaseTerms` in `@leaseguard/domain` (forms warn with
  `editRequiresReverification`); the reference, notes, deposit receipt date, renewal notes and guarantee status are not
  terms.

## Generating the contract and the client

After changing a controller, DTO or schema:

```sh
pnpm api:generate
```

This builds each service and writes its document (`backend/openapi.json` from `backend/src/generate-openapi.ts`,
`services/reports/openapi.json` from `services/reports/src/generate-openapi.ts`, each run with its `.env.example`
values so no services are needed), then regenerates `packages/api-client/src/generated/schema.ts` and
`packages/api-client/src/generated/reports-schema.ts` with openapi-typescript. Commit all four files.

## Using the typed client

`@leaseguard/api-client` (`packages/api-client/src`) wraps openapi-fetch with `GatewayPaths`: the core's generated
`paths` and the reports service's (without its health routes, which the gateway sends to the core), so one client
with one base URL calls every service:

```ts
import { createApiClient, unwrap, isApiError, COMPANY_ID_HEADER } from '@leaseguard/api-client'

const api = createApiClient({
  baseUrl: 'http://localhost:5173',          // the gateway (the Vite dev server in development); paths include /api/v1
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
  package root; the reports service's are under the `Reports` namespace (for example `Reports.ReportCatalogueDto`).

In the frontend, the single client instance is `getApiClient()` in `frontend/src/services/api/client.ts`.

## Not implemented yet

Checked against `backend/openapi.json` and `backend/src`:

- Archive, renewal or termination endpoints for leases (create, edit and verification exist).
- Creating or drafting outbound messages and templates; companies' WhatsApp settings.
- WhatsApp webhooks (delivery status, inbound replies).
- Request rate limiting.
