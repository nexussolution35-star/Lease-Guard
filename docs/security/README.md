# Security model

What protects LeaseGuard data today, where each control lives, and the known gaps. LeaseGuard holds
commercially sensitive lease, tenant and statement data and personal contact details. It never
handles payments or banking credentials.

Related: [Architecture overview](../architecture/overview.md) · [API conventions](../api/README.md) ·
[Database](../database/README.md) · `infrastructure/deployment/README.md` (secrets in production).

## Authentication

- **Users** sign in with Supabase Auth (email and password). The web app uses supabase-js with the
  public anon key for sign-in only (`frontend/src/services/api/supabase.ts`); records come from the API.
- **API** (`SupabaseAuthGuard`, global): every route except `GET /health`, `GET /health/ready` and Meta's
  WhatsApp webhook (`GET`/`POST /api/v1/webhooks/whatsapp`, which authenticates Meta with the verify token and the
  app-secret signature over the raw body; see docs/integrations/whatsapp.md) requires `Authorization: Bearer <access token>`. Tokens are verified with `auth.getClaims` and must
  have `role = authenticated` and a subject, so the anon key and the service-role key are refused as
  bearer tokens. A 401 makes the web app sign out locally and return to `/login`.
- **Accounts are invite-only**: public sign-up is off (`enable_signup = false`). A company admin invites
  a user; the worker sends the invitation through Supabase Auth.
- **Email**: Supabase Auth sends every email (invitations, password links, the password-changed notice)
  using the branded templates in `supabase/templates`. Locally they are captured by Mailpit
  (`http://127.0.0.1:54324`). The hosted project delivers them to each user's own address through
  custom SMTP from `noreply@leaseguard.com`; `pnpm auth:configure:remote` applies the SMTP settings,
  templates and the settings below (dry run first, `-- --apply` to apply). The sender domain must be
  verified with the SMTP provider (SPF and DKIM) and the SMTP credentials stay in the operator's `.env`.
- **Email links expire after 3 minutes** (`otp_expiry = 180`) and work once. An administrator can
  resend an expired invitation; a password link can simply be requested again.
- **Password changes require a fresh email link** (`secure_password_change = true`): the profile menu
  emails a link, and the new password is set on `/auth/reset-password`. A signed-in session alone cannot
  change the password.

## Company authorisation

Two layers, deliberately redundant:

1. **API boundary.** `CompanyAccessGuard` requires an `X-Company-Id` header naming a company where the
   caller is a member (400 / 403), and `CompanyRoleGuard` limits writes to `WRITER_ROLES`
   (`company_admin`, `property_manager`). See [API conventions](../api/README.md#company-scoping).
2. **Row Level Security (the enforcing layer).** Every API query runs through a Supabase client built
   from the anon key plus the caller's own token, so Postgres decides what each request may read or
   write (`private.is_company_member`, `private.can_write`, `private.has_company_role`). Another
   company's record is 404 even when its id is known. See
   [Database](../database/README.md#row-level-security-model).

The worker is the only process with the service-role key, which bypasses RLS. Its queries always
filter by `company_id` explicitly, and job payloads name their company.

Signed-in users can also reach the Supabase Data API directly with their own token and the public
anon key. That is why RLS, constraints and triggers, not the API, are the security boundary for data.
Rules that exist only in the API are listed under [known gaps](#known-gaps).

The frontend's workspace switching is a convenience. It is not a security boundary.

## Least-privilege configuration

The server processes share one contract (`backend/.env.example`, copied to `backend/.env`; the web app has its own
`frontend/.env` with public values only), but each process loads
only what its own schema declares:

| Process | Loader | What it loads |
| --- | --- | --- |
| API | `loadApiEnv` in `backend/src/config/env.ts` | only `API_ENV_KEYS`; never the service-role key, the document-processing token or WhatsApp tokens |
| Worker | `loadWorkerEnv` | `WORKER_ENV_KEYS` plus variables matching `WHATSAPP_ACCESS_TOKEN_KEY` (`^WHATSAPP_ACCESS_TOKEN_[0-9A-F]{32}$`: one per company, named by its uuid without dashes in uppercase) |
| Number import command (operator, `pnpm whatsapp:import-test-number`) | `loadNumberImportEnv` | `NUMBER_IMPORT_ENV_KEYS` only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `QUEUE_PREFIX` and the test number's `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID`; the file is read only when one of them is missing from the process |
| Document processing | pydantic-settings (`python-services/document-processing/app/core/config.py`, `extra="ignore"`) | its declared fields only |
| Web app | Vite | only `VITE_*` variables reach the browser |

Variables already set in the process environment win over the file. Each process validates its
configuration at start-up and refuses to start, naming every missing or invalid variable.

**Browser secret guard.** Vite bundles every `VITE_*` value, so a secret placed there would be public.
`frontend/src/services/api/exposedSecrets.ts` detects Supabase secret keys (`sb_secret_…`) and JWTs
whose role is `service_role`. It is applied twice: `frontend/vite.config.ts` refuses to serve or build,
and `frontend/src/services/api/config.ts` renders the configuration error screen instead of the app.

**Docker Compose** (local development) mirrors this for the API and the document-processing service,
which receive only their own variables. The `worker` service receives the whole `backend/.env`
(`env_file`), because it also needs one WhatsApp token variable per connected company
(`WHATSAPP_ACCESS_TOKEN_<company uuid without dashes, uppercase>`); the worker process itself still
loads only its schema's variables (and those token variables) when it reads the `.env` file directly.

Images contain no `.env` file (root `.dockerignore`) and run as non-root users (`node`, `nginx`,
`leaseguard`).

## Service-to-service secrets

- **Document processing.** The worker sends `DOCUMENT_PROCESSING_TOKEN` as a bearer token; the Python
  service compares it in constant time (`hmac.compare_digest`) and refuses every extraction with 503
  while no token is configured. The worker refuses to start in production with a token shorter than
  32 characters. The service is meant to be reachable by the worker only.
- **Meta app and AI settings.** `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is loaded by the API only,
  `ANTHROPIC_API_KEY` by the worker only (each process loads only its own schema's keys). `WHATSAPP_APP_ID`
  and `WHATSAPP_APP_SECRET` are loaded by both: the API exchanges Embedded Signup codes and checks webhook
  signatures, the worker authenticates Meta's `debug_token` with the app access token while verifying a
  number (ticket 04). The worker never logs or returns either, and reports only whether it has them.
  `GET /api/v1/integrations/whatsapp/capabilities` returns flags, the public app and Embedded Signup
  configuration ids and the names of missing settings, never a secret value; the worker reports whether
  it has an Anthropic key as a boolean through Redis. The Vite build and the web app refuse to start when
  a `VITE_*` variable names a server-only setting, holds an Anthropic-shaped key, or equals the Meta app
  secret, the verify token or the Anthropic key (`frontend/src/services/api/exposedSecrets.ts`).
- **Registration PIN.** The 6-digit PIN an admin enters to register a number is never stored: the API
  puts it in one Redis key under the queue prefix (expires after 10 minutes) and the worker deletes it as it
  reads it (`GETDEL`), so it reaches neither Postgres, `job_runs`, BullMQ's job history nor a log
  (`backend/src/infrastructure/whatsapp/registration-pins.ts`).
- **Nexus Solution's test number (number import, ticket 15).** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
  `WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID` are loaded by the operator command `pnpm whatsapp:import-test-number` only
  (`loadNumberImportEnv`: its own seven keys, from the process environment, reading `backend/.env` only when one is
  missing), never by the API or the worker. The command uses the service-role key, like `platform:create-company`,
  and hands the token to `public.import_whatsapp_number` (service role only), which stores it in Vault as
  `whatsapp_access_token:<company id>:import:<uuid>` for the named company only. Every line it prints has the token
  replaced by `[redacted]`; the verification job carries ids only.
- **WhatsApp access tokens** are never stored in plain columns or in `.env.example`.
  `whatsapp_phone_numbers.access_token_reference` takes one of two forms (formats:
  `backend/src/infrastructure/whatsapp/access-token-reference.ts`; the database CHECK
  `private.is_whatsapp_token_reference` accepts the same set, checked by a parity test):
  - `secret://env/WHATSAPP_ACCESS_TOKEN_<company uuid without dashes, uppercase>`: a worker
    environment variable, bound to the row's own company, so it cannot name another worker secret
    (such as the service-role key) or another company's token. The bare `WHATSAPP_ACCESS_TOKEN` and
    name-based variables are not accepted.
  - `secret://vault/<vault secret uuid>`: a Supabase Vault secret named
    `whatsapp_access_token:<company id>` (optionally followed by `:<suffix>`). The worker reads it with
    `public.whatsapp_account_access_token(number id)`, executable by the service role only, which
    returns nothing unless the secret is named for the number's own company.

  Signed-in users can neither set nor read the reference (no column grants since
  `20261110100400`; the trigger derives the env form on insert and keeps the stored reference on
  update), and the API selects number columns explicitly, so no response carries it. Only the WhatsApp channel module
  (`backend/src/infrastructure/whatsapp/whatsapp-channels.ts`) resolves tokens; an unusable reference
  fails the message permanently.

## Storage

Statement and lease-document files are in private buckets (`statements`, `lease-documents`) under
`<company_id>/<entity_id>/<file name>`. Policies on `storage.objects` let members of the company in the
first path segment read, and writers upload; writers replace and delete statement files only. The API issues signed
upload URLs through the caller's own client, so storage policies apply to uploads as well. Limits: 20 MB; statements
PDF, PNG and JPEG; lease documents PDF only. A lease document is recorded only after the API has read the stored file
back (size, stored media type and the `%PDF-` header) and computed its SHA-256; the database stamps the uploader from
`auth.uid()`, accepts only a file that is in the bucket, and keeps the record and its file (no update or delete by a
signed-in user). A statement is registered only after the API has read the stored file back (size, the `%PDF-`
header, SHA-256 equal to the one the browser computed); a signed-in caller inserts only the upload's own columns, so a
new statement is always `uploaded` with no figures, its uploader and time are stamped from the session, and every
registration is audited. An identical file already on record is refused and the copy just uploaded is removed.
Downloads are five-minute signed links issued through the caller's own client. Figures reach a statement only through
verification: a signed-in caller cannot write them (column grants), cannot move a statement into or out of verified,
rejected or duplicate directly (`private.guard_statement_outcome`), and verifies, rejects or marks a duplicate only
through `verify_statement`, `reject_statement` and `mark_statement_duplicate` (`SECURITY DEFINER`, writer of the company
checked first), which copy the reviewed extraction's values and stamp the verifier from the session. `verify_statement`
checks the period and that the lease was in force on the reviewed statement date itself, since a writer can set the
lease directly. A signed-in caller cannot write an extraction's status or review notes, nor a statement's status or
processing error (`20261121194500_statement_review_integrity.sql`): the worker writes them with the service role, the
outcome functions close a review, and `retry_statement_processing` (`SECURITY DEFINER`, writer check) is the only way to
put a failed statement back to `uploaded`. A statement number that is not on the document is confirmed as absent and
audited, never invented.

Portfolio import files (CSV and XLSX exported from a company's own system) are kept in the private
`portfolio-imports` bucket under the same path shape: members read; company admins and property managers
upload; nobody signed in replaces or deletes an original. Limit: 5 MB; `text/csv` and the XLSX media type
only. The API reads the file through the caller's own client and parses it in process (no external
service): XLSX parts are inflated with a per-part ceiling, so a small archive cannot expand without bound.
Row fixes (ticket I-03) follow the same roles: only company admins and property managers correct, skip or
link a batch row (the API's writer guard and the `writers_update` policy, limited by column grants to the
four fix columns); who made the change is stamped from `auth.uid()` and every change is audited.
Approving an import (ticket I-04) is writer-only too: `apply_portfolio_import` is SECURITY INVOKER, so the
new properties and units are held to the same grants, RLS policies and guards as the property and unit forms;
the approval is stamped from `auth.uid()` and refused outside that function, the created-records list is
written only by a trigger, and importing writes no communication, approval request or schedule. Tenants an
import creates (ticket I-05) go through the same `tenants` column grants, RLS and audit as the tenant form; their
WhatsApp numbers start unvalidated, so no automated message can reach them until a writer validates the number.
The decision on a suggested tenant is a writer-only column of the batch row, checked by the API to name a tenant
of the workspace (and by the composite foreign key), and stamped and audited like the other row fixes.

Assigning a tenant to a unit without a lease (ticket M4-04) has one write path: `assign_tenant_to_unit` and
`end_unit_tenant_assignment` (`SECURITY DEFINER`, `search_path = ''`, `can_write` checked first, 42501 otherwise).
Signed-in callers hold only SELECT on `unit_tenant_assignments` (RLS: members of the company), so a direct Data API
insert, update or delete is refused; the guard applies to every role (tenant and unit of the company through
composite keys, archived property, who holds the unit), who and when are stamped from `auth.uid()`, and each assign
and unassign is audited. An assignment never enables tenant messaging or monitoring: nothing it writes reaches
`communications` or `monitoring_events`, and monitoring still reads verified leases only.

A Google Sheets import (ticket I-06) is the API's only outbound fetch on a person's behalf, and it is not a
URL fetch: the link must match `docs.google.com/spreadsheets/d/<id>` (`parseGoogleSheetsLink` in
`@leaseguard/domain`), and the API requests only the CSV export address it builds from the spreadsheet id and
tab id. Redirects are followed by hand (`redirect: 'manual'`), only over HTTPS to `docs.google.com` or a
`*.googleusercontent.com` download host, with no port or credentials, at most three times; a redirect to
`accounts.google.com` means the sheet is not shared. The whole read is limited to 20 seconds and the body
to 5 MB, counted while streaming. Only the spreadsheet id and tab id are stored, never the pasted URL
(`backend/src/modules/portfolio-imports/google-sheets/fetch-google-sheet.ts`).

## Tenant communication controls

Enforced in several places, from the strictest outwards:

| Rule | Where |
| --- | --- |
| Tenants receive only the five tenant message types (monthly statement; initial, overdue and follow-up payment reminders; arrangement instalment reminder) | `canSendTenantMessage` in `@leaseguard/domain`; database CHECK `communications_tenant_message_type_check` |
| Tenant message text must not mention forbidden topics (rental escalation, lease expiry, renewal option, dispute, bank guarantee, deposit) | `checkOutboundMessage` in `@leaseguard/domain` |
| No banking details in any message text (bank wording, account-number-like digit runs, IBANs) | `findBankDetails` / `checkOutboundMessage` in `@leaseguard/domain` |
| Active payment arrangements suppress normal arrears reminders | `canSendTenantMessage` |
| A tenant's WhatsApp number must be validated before automated communication is enabled, and a changed number is unvalidated again (PRD §5.4) | `canSendTenantMessage` (unvalidated number blocks sending); database trigger `reset_whatsapp_validation` on `tenants` (every role) and column grants (signed-in users cannot set `whatsapp_verified` or who validated it); writers validate only through `validate_tenant_whatsapp_number` (`SECURITY DEFINER`, `can_write` checked first, only the number still on record, audited as `verify`); the tenant write API refuses the flag in a body and stores numbers in E.164 (`normalizeWhatsAppNumber`) |
| Every tenant message needs an approved approval before sending, in every company (a hard constraint, not a setting) | `canSendTenantMessage` in `@leaseguard/domain`, applied by the outbound gate; database trigger `tenant_message_requires_approval` (no company switch) |
| A message is approved only if delivery would send it | The outbound gate: the approve endpoint refuses (422, every reason) a changed recipient number, a channel that is not connected, a template that is not approved or does not match, or text that cannot be expressed as the template, exactly as delivery would |
| Any `company_admin` or `property_manager` may approve or reject, including the person who requested the approval (single-manager companies must be able to send); `read_only` and `property_owner` cannot | `@CompanyScoped({ roles: WRITER_ROLES })` on the approve/reject routes (403); write policies (`private.can_write`) in the database |
| An approval is an explicit decision recorded with its approver | The decision and the status move are one transaction (`public.decide_communication`, run as the signed-in user); the database stamps the approver from `auth.uid()`, so it cannot be forged. The outbound gate refuses an approved approval whose `decided_by_user_id` is null (API recovery paths 422; worker fails the message without sending) |
| Approval requests start pending and stay bound to their message | Database: an approval row can only be inserted as `pending`, and cannot be moved to another message or requester |
| Approved content is locked | Database: once a message is approved its body and recipient cannot change; the outbound gate additionally refuses approval and delivery when the recipient's WhatsApp number no longer matches the message's |
| A decision is made once | Approving or rejecting an already decided message is 409 (`decide_communication` locks the message and only decides one still awaiting approval) |
| Every status change follows the lifecycle, for every API role | `private.communication_status_transitions`, enforced by `private.guard_message_write` for signed-in users and the service role (only the database owner is exempt). Signed-in users can only submit, decide, reopen a never-approved message, and stop one; claiming, recording sends and failures, and WhatsApp statuses are service-role functions. The content lock applies to the service role too |
| A message is sent at most once | The worker claims a message (`approved` to `queued`, one winner) immediately before sending, and the claim records `send_uncertain_since`. A possibly sent message (claimed, or failed with an unknown outcome) is never claimed or retried automatically; only a person can create a new message. Only the run holding the claim (its token) can hand it back or record that its send did not happen, so another run of the same job cannot erase the fact while a send is in flight. The service role cannot write status or delivery columns outside the lifecycle functions, nor record `sent` without a WhatsApp message id. A send that went out while the message was failed or stopped is still recorded as sent |
| Inbound messages are not part of the outbound lifecycle | A `received` message never changes status; only the backend (the webhook, next) creates one |

The outbound gate (`checkOutbound`, `backend/src/messaging/outbound-gate.ts`) runs twice with the
same reads and rules: when a manager approves (as if the approval were granted; blockers become a 422
listing every reason) and in the delivery worker immediately before it claims the message (blockers
fail the job without retry). Only an access token that cannot be resolved is found later, when the
worker opens the channel. Messages are sent only through the official Meta WhatsApp Cloud API, from
the WhatsApp Business account of the company that owns the message.

## Audit logging

`audit_logs` is append-only (UPDATE, DELETE and TRUNCATE are rejected by trigger). Database triggers
record lease verification, lease creates and edits (a term change resets verification; guarantee changes too), statement verification and changes, extraction review and field
corrections, monitoring event status changes, message approval decisions, invitations, changes to a
company's details and monitoring settings, member role changes and member removal, stamping the actor from
`auth.uid()` so the client cannot forge it. The log is readable by `company_admin`, `property_manager`
and `read_only` members, not by property owners. See [Database](../database/README.md#audit).

## Logging and errors

- The API logs JSON (pino). `Authorization`, `Cookie` and `apikey` request headers are redacted.
  Secret query parameters are replaced with `[Redacted]` in the logged url and query, and in the url of
  an unhandled-error log: Meta's webhook handshake sends `hub.verify_token` in the query string
  (`backend/src/common/logging/redact-url.ts`).
- Every response has an `X-Request-Id`; error bodies include the same id.
- Unexpected errors return a generic 500; database errors are mapped to generic messages, so
  constraint and policy names are not returned to clients.
- The API sets security headers with helmet and allows CORS only from `API_CORS_ORIGINS`. The frontend
  nginx image sets `X-Content-Type-Options`, `X-Frame-Options: DENY` and a referrer policy.

## Known gaps

Verified against the code in this change set:

- **No rate limiting** on the API. Only Supabase Auth's own limits apply to sign-in.
- **No WhatsApp webhooks.** Delivery statuses, inbound replies and opt-outs from Meta are not received
  yet (`whatsapp_phone_numbers.webhook_configured` exists, but there is no webhook endpoint).
- **Swagger UI** at `/api/docs` is served without authentication; restrict it at the edge in
  production if the API description should not be public.
- **No Content-Security-Policy or HSTS** on the frontend image; add them at the edge, where the API and
  Supabase origins are known.

## Data protection

LeaseGuard processes personal information (tenant contacts, WhatsApp numbers, user profiles) and
commercially sensitive lease and financial data. Every deployment must be reviewed against South
African data-protection requirements, including **POPIA**, before real client data is loaded. This
repository does not implement or document that review.
