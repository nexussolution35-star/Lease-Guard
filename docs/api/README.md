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

- **Unit list** (`listUnits`): each item is a `UnitListItem`: the unit with its `property`
  (`id`, `name`, `code`) and, while the unit has an active lease, `currentTenant` (`id`,
  `tradingName`) and `currentLease` (`id`, `reference`, `commencementDate`, `expiryDate`), read from
  `currentTenantId` / `currentLeaseId` through the company-scoped foreign keys (RLS applies to every
  embedded row). Filters: `propertyId`, `type`, `occupancyStatus`; `search` matches the unit number.
  `getUnit` returns the plain `Unit`.
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
  trading names and the contact person. `getTenant` returns the plain `Tenant`.

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
  `statements` bucket; the client uploads the PDF; `registerStatement` records it, runs duplicate
  detection (identical SHA-256 → 409; likely duplicate → registered with a warning) and enqueues
  `statement-processing`. `processStatement` re-queues extraction.
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
- **Monitoring status changes** follow the transitions in `@leaseguard/domain`; a disallowed move is
  409 and dismissing requires a `note` (the dismissal reason).
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

- Archive, renewal or termination endpoints for leases (create, edit and verification exist).
- Statement review: confirming or correcting extracted figures, and statement verification.
- Creating or drafting outbound messages and templates; companies' WhatsApp settings.
- WhatsApp webhooks (delivery status, inbound replies).
- Request rate limiting.
