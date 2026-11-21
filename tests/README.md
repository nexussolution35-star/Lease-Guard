# @leaseguard/tests

Cross-service tests that run real processes. Unit and component tests live next to the code in each
package (`pnpm test`). Neither suite here is part of `pnpm test`: both need running services.

| Command (repository root) | What runs |
| --- | --- |
| `pnpm test:integration` | Vitest (Node) against the real compiled API, the local Supabase stack and Redis |
| `pnpm test:e2e` | Playwright (Chromium) against the real stack: the compiled API and the Vite dev server on the local Supabase stack |
| `pnpm --filter @leaseguard/tests typecheck` | Type checks both suites and the shared fixtures |

```
tests/
  fixtures/      shared by both suites: world.ts (per-run test data), API process, Redis, local Supabase/SQL helpers, PDF generator and sample statements, statements acceptance portfolio, monitoring acceptance portfolio, paths
  integration/   vitest.config.ts, global-setup.ts, support/ (clients, row snapshots), *.test.ts
  e2e/           playwright.config.ts, global-setup.ts (world), support/ (run-api.ts, statement-worker.ts, app.ts locators, world.ts), *.spec.ts
  test-results/  output: API log, Playwright traces and screenshots (ignored by git)
```

## Integration suite

### Prerequisites

1. Dependencies installed: `pnpm install`.
2. Docker running and the local Supabase stack started with the latest migrations: `pnpm db:start`
   (then `pnpm exec supabase migration up` after pulling new migrations). The database may be empty:
   the suite creates every row it needs (see "Test data" below) and does not rely on any seed.
3. Redis on `redis://127.0.0.1:6379`, e.g. `docker run -d --name leaseguard-redis-dev -p 127.0.0.1:6379:6379 redis:7.4.12`.
   Set `INTEGRATION_REDIS_URL` to use another local Redis.

If any prerequisite is missing the run fails before a single test starts, with a message saying what
to start. It never skips tests or passes vacuously.

### How the environment is chosen

The suite writes and deletes data, so it never trusts `backend/.env` (which may point at a
hosted project):

- Supabase URL, anon key and service-role key come from `supabase status -o env` (the CLI pinned in the
  root `package.json`). The run refuses to start unless the URL (and the Redis URL) is on this machine.
- The global setup builds `@leaseguard/domain` if its `dist` is stale (`backend/scripts/domain-build.mjs`,
  which runs `pnpm --filter @leaseguard/domain build` under a lock), compiles the API with
  `tsc -p tsconfig.build.json --outDir .dev-integration` into `backend/.dev-integration`, and starts
  `node .dev-integration/main.js` on a free port.
- The API process gets an explicit environment: every variable it reads (`API_ENV_KEYS` from
  `backend/src/config/env.ts`) is set, using the local Supabase URL and anon key, `REDIS_URL`, a unique
  `QUEUE_PREFIX` (`lg-it-<pid>`) and `.env.example` defaults for the rest. Process variables win over
  `.env`, so `backend/.env` is never read. The API never receives the service-role key.
- It then builds the reports service (ADR 0003) into `services/reports/.dev-integration`
  (`fixtures/reports-server.ts`; `@leaseguard/domain` and `@leaseguard/service-kit` first when stale) and starts it on
  a free port with an explicit environment (its `REPORTS_ENV_KEYS`: the same local Supabase URL, anon key and Redis,
  `.env.example` for the rest; never the service-role key), then a gateway in the test process
  (`fixtures/gateway.ts`: a streaming HTTP proxy routing with `infrastructure/gateway/routes.json` and the same
  matching as the Vite dev proxy). Tests call every service through it with `gatewayAs(user, company)`
  (`support/clients.ts`), as the web app does; `apiAs` still calls the API directly. Reports output goes to
  `tests/test-results/integration/reports.log`.
- The setup creates this run's world (below), waits for `GET /health/ready`, signs in the world's users
  once through local Supabase Auth (local Auth rate-limits sign-ins) and hands URLs, tokens and the
  world to the tests with Vitest `provide`/`inject`.
- Teardown stops the gateway and the reports service (deleting `services/reports/.dev-integration`), stops the API,
  deletes `backend/.dev-integration` and every Redis key under the run's queue
  prefix (registered statements and approvals enqueue BullMQ jobs; no worker consumes that prefix), then
  destroys the world and asserts nothing of it is left.

### Test data

Local development and both suites start from an empty database; there is no seed. Each run creates
its own data with the service-role key through `tests/fixtures/world.ts` (`createWorld()` /
`destroyWorld()`), with a unique run id in every email and company name, so repeated or parallel runs
never collide:

- two companies (A and B);
- four Auth users created with the Auth admin API (email confirmed, random password, active profile
  with phone, WhatsApp number and job title): `admin` (company_admin of A), `manager` (property_manager
  of A, the default workspace, and of B), `readOnly` (read_only of A), `owner` (property_owner of A);
- in A: four properties (ACP, BOT, CRV, DIP), seven units, four WhatsApp-verified tenants, seven leases
  (three verified, one `pending_verification`, three `draft`) and two monitoring events in `new`;
- in B: one property, unit, tenant and lease.

`destroyWorld()` removes the world's storage objects, every company-scoped row, the memberships, the
companies and the Auth users, then checks that nothing is left. `audit_logs` is append-only and
references companies (`on delete restrict`) and actor profiles, so a company or user that the tests'
audited actions touched cannot be deleted: such a company is left empty and `archived`, such a user is
soft-deleted in Auth (cannot sign in) with its profile `deactivated`. Audit entries are never removed.

API output goes to `tests/test-results/integration/api.log`.

### What is covered

| File | Behaviour |
| --- | --- |
| `auth.test.ts` | readiness; 401 without or with a malformed token; `GET /me` memberships |
| `reports-service.test.ts` | The reports service (ticket R-00) through the gateway: its own liveness and readiness (Redis and Supabase up); `GET /api/v1/reports` returns the domain `REPORT_CATALOGUE` to every member role of company A, and is not served by the core API (404 there); 401 without or with a forged token, 400 without `X-Company-Id`, 403 for company B (the admin is not a member); `/api/v1/me`, `/health` and the look-alike `/api/v1/reportsx` still reach the core; `no-store` through the gateway |
| `reports-lease-dates.test.ts` | Lease expiry and renewal deadlines (ticket R-03) through the gateway: the rows are exactly the company's verified monitored leases in the database, with days and buckets from the as-at date; within notice and requiring a warning equal what the monitoring scan raises with the company's thresholds; a lease this file adds (expiring in 60 days, one-month notice) is in the 0–3 month bucket with its deadline, linking to its open expiry and renewal events, the dashboard counting the open expiry events; bucket, date range, property and deadline-status filters stated back, an unoffered status 400; the same for every member role, another company 403 |
| `reports-deposits-guarantees.test.ts` | Deposits and guarantees (ticket R-04) through the gateway: four leases added to property CRV of company A dated from today (a guarantee and deposit short after an 8% escalation, a guarantee expiring in 10 days, one expired, one lease pending verification); each verified lease's required cover, shortfall and guarantee state, the unverified one left out and counted as the database holds it, the totals adding up the rows; the figures equal the events the worker's real lease monitoring scan raises for the same leases on the same day (in process, service role, no queue); guarantee state and expiry range filters stated back, 400 for a status it does not offer or a range that ends before it starts; the same for every member role, 403 for another company, no writes |
| `company-isolation.test.ts` | 403 for a company the caller is not a member of; 400 without/with a bad `X-Company-Id`; another company's ids are 404 even under the caller's own company (RLS plus company filter); a member of both companies only sees the active one |
| `lists.test.ts` | `GET /leases`: paging with stable order, filters, search, sort, 400 for invalid parameters |
| `tenant-list.test.ts` | `GET /tenants` (ticket M4-02): each world tenant with its current lease (domain `currentLease` over the database's leases), unit number, property name and lease count; the property filter keeps only tenants with a lease there and narrows the embedded leases; combined with search and paging; another company's tenants never listed, even filtered by its property; a non-UUID property is 400 |
| `leases.test.ts` | `read_only` cannot verify (403); a property manager verifies an unverified lease (status becomes `active`, verifier and time stamped); idempotent re-verify |
| `monitoring.test.ts` | A property manager's direct Data API update of an event's status, description, calculation or notes is refused (42501) and changes nothing; the database's transitions equal the domain `canTransition` for every pair; a dismissed event keeps its reason and cannot move again through the API (409, audited once); the service role still writes; `read_only` 403; dismissal needs a reason (400); allowed move `new → under_review` (200); disallowed move `under_review → resolved` (409) |
| `monitoring-detail.test.ts` | The monitoring event detail and workflow (ticket M7-02): one escalation event added to company A with the service role (removed in `afterAll`); the detail names its property, unit, tenant and assignee and keeps its calculation for read-only members and owners, and is 404 from company B; a manager walks `new → under_review` (with a note) `→ action_required → in_progress → dismissed` (with a reason), each move allowed by `nextEventStatuses` and answered with the names; the history (`GET /audit-logs?entityType=monitoring_event&entityId=…`) holds the four moves with the manager as actor, the note and the dismissal reason as field changes; a dismissed event never moves again (409); read-only members see the history, owners get 403 |
| `monitoring-list.test.ts` | The monitoring list (ticket M7-01): two events added to company A with the service role (one on an active verified lease, assigned to the manager, critical, due in 10 days; one on another property, unassigned, low, overdue; removed in `afterAll`), each request searching this run's tag: every item names its property, unit, tenant (trading name), lease reference and assignee (full name) for any member, and leaves absent ones out; the unit, tenant, lease, assignee (one member or `unassigned`) and due-date (`overdue`, `next_30_days`, `next_7_days`, on the South African date) filters each narrow it, also combined with type, priority and `open`; malformed filters are 400; company B's members never see them |
| `dashboard-summary.test.ts` | The dashboard summary (ticket M7-05): every figure equals the database's own count for the company (properties not archived, their units and occupied units, active leases, active arrangements, statements in review, pending approvals, open events of each dashboard type), the balances (one database query, `dashboard_arrears_totals`) equal `GET /statements/arrears`; an open escalation discrepancy added counts, a dismissed lease expiry does not; company B's figures are B's; a read-only member reads the same figures and cannot read company B's (403); no company is 400 |
| `statements.test.ts` | `read_only` 403; registering before uploading is 422; signed upload URL → upload of a generated PDF with the anon key → register (201, job queued) → same file again 409 with the existing statement in `duplicate` |
| `whatsapp-integration.test.ts` | several business accounts and numbers per company (added with the service role, removed in `afterAll`): any member lists their own company's accounts and numbers with statuses; another company's are never listed (403 for a company the caller is not in; a member of both sees only the active company's); through PostgREST with a member's own sign-in another company's rows are invisible and `access_token_reference` is refused (42501); the company resource carries a number summary without the credential reference; capabilities are public-safe (all off with `.env.example`, each missing setting named with its process; 401 without a token) |
| `approvals.test.ts` | on a tenant message the test creates (requested by a property manager): `read_only` 403 and the message stays pending; the requester approves their own request (200, recorded as the approver, exactly one `message-delivery` job in the run's queue prefix); approving again 409 with no second job; rejecting the approved message 409 |
| `users-and-invitations.test.ts` | every member lists company A's members (only A's membership); the active-admin count filter; an admin changing their own role or removing themselves 403; other roles 403; an admin changes another member's role and back; removing a member still named on records 409; invite (email lower-cased, `pending`), duplicate 409, resend, revoke, revoke or resend again 409; inviting an existing member 409; invitations refused to other roles and to a non-member company (403). Invitations it creates are deleted in `afterAll` |
| `whatsapp-acceptance-two-businesses.test.ts` | The acceptance scenario of the WhatsApp work (ticket 14), end to end; see below |
| `whatsapp-test-number-import.test.ts` | The number import (ticket 15): runs the operator command `whatsapp:import-test-number` from this run's build (`backend/.dev-integration/operator/import-whatsapp-test-number.js`) with only its own seven settings, all local (so `backend/.env` is never read), against the world's company A. Dry run by default (nothing written), `--apply` refused without a terminal unless `--yes`, an unknown company and a number company B has connected refused (B named), then the import: the token in Vault for A only (never printed, never in the job), the account and number pending verification and marked imported; the worker's real number verification runs in the test process (`support/in-process-worker.ts`, own queue prefix `<run prefix>-import`) against the fake Graph API and connects it; the integration page's API shows it connected with every step passed and `operatorImportedAt`, and B's members never see it; re-running leaves a connected number alone; a newer token replaces the stored one (old secret deleted) and the number is verified again with it. Its rows, Vault secrets and Redis keys are deleted in `afterAll`; worker log `test-results/integration/worker-test-number-import.log` |
| `statement-acceptance.test.ts` | Statements acceptance (ticket S-09), monitoring side: two units, tenants and verified leases added to the world's property DIP (`fixtures/statement-acceptance.ts`; lease 1 is the PRD's R35 000 at 8% a year example). Statements that are uploaded, under review, rejected (API) or a duplicate (API) carry no figures and raise no arrears or escalation event: the worker's real arrears and lease scans and the `statement-monitoring` job (built in this process from the backend source, service role, no queue consumed; log `test-results/integration/worker-statement-acceptance.log`) find nothing and the job skips them as `not_verified`. Once a statement is matched and verified through the API, the job raises the arrears event (the verified balance) and the escalation discrepancy (expected R37 800.00, R2 800.00 short), both naming the statement, its tenant and lease; running it again raises nothing new. The portfolio and everything raised from it are removed in `afterAll` |
| `monitoring-acceptance.test.ts` | Monitoring accuracy acceptance (ticket M7-06), PRD §13.4 with the §5.7 A-E examples; see "Monitoring accuracy acceptance" below. One unit, tenant and lease per rule added to the world's property DIP (`fixtures/monitoring-acceptance.ts`); the worker's real `lease-monitoring` and `arrears-monitoring` scans (built in this process, service role, no queue consumed; log `test-results/integration/worker-monitoring-acceptance.log`) run on a fixed date per scenario, limited to its tenant. Each rule raises exactly its event with the PRD figures, assigned to the property's manager (notified when high or critical) and traced through `GET /monitoring/events/{id}` to its lease, tenant, unit, property and statement; scanning again raises nothing; a lease pending verification and a statement under review raise nothing on any date (the database also refuses a guarantee shortfall on unverified terms), and the same terms raise their events once a manager verifies the lease through the API; no communication is created for any of its tenants and the database refuses a tenant message that is not a statement or payment message. Removed in `afterAll` |

### Acceptance scenario: two businesses stay apart

`whatsapp-acceptance-two-businesses.test.ts` runs with the rest of the suite (`pnpm test:integration`; on its own:
`pnpm --filter @leaseguard/tests exec vitest run --config integration/vitest.config.ts whatsapp-acceptance`). Same
prerequisites as the suite (local Supabase, local Redis); nothing else to configure. It takes about a minute.

- **Its own businesses.** It does not use the world: it creates *Atlas Properties* and *Baobab Estates* through the
  operator command `infrastructure/scripts/platform-create-company.mjs` (run with only the local `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `WEB_APP_URL` in its environment, so it never reads `backend/.env`; unused initials
  are picked because the command refuses existing ones) and each admin, whose confirmed account the test created,
  accepts the invitation through the API. A tenant of Atlas is inserted with the service role.
- **Its own API process** of this run's build (`backend/.dev-integration`), with a test Meta app (app id, Embedded
  Signup configuration id, app secret, webhook verify token; none of them real), `WHATSAPP_GRAPH_API_URL` pointing at
  the fake Graph server, and its own queue prefix `<run prefix>-acceptance`. Log:
  `tests/test-results/integration/api-acceptance.log`.
- **The worker in the test process** (`integration/support/in-process-worker.ts`): the worker's real processors for
  number verification, webhooks, the AI agent, message delivery and test messages, built by hand as `WorkersModule`
  wires them, consuming that queue prefix on the local Redis with the service role of the local stack. The agent's
  model is `FakeAgentLlm` (answers only from its prompt's knowledge, records every prompt) and the channels use the
  fake Graph server; the worker env gets an unresolvable Graph URL, so nothing can reach Meta. The processors' NestJS
  decorators are why `integration/vitest.config.ts` compiles legacy decorators and `tsconfig.json` sets
  `experimentalDecorators`. Log: `tests/test-results/integration/worker-acceptance.log` (job outcomes, ids only).
- **The fake Graph API** (`integration/support/fake-meta-graph.ts`) on 127.0.0.1: code exchange, `debug_token`, phone
  numbers, `subscribed_apps`, register, templates and sending, per business; a business token used on another
  business's account or number is refused (403) and recorded, and every request is kept for assertions.
- **Webhooks** are signed with the test app secret and posted to the API exactly as Meta would; the test waits for the
  worker to finish each payload (`whatsapp_webhook_events`).
- **Cleanup** (`afterAll`): the worker, API and fake server are stopped; the webhook events and their job runs (stored
  without a company), the companies' Vault secrets and the prefix's Redis keys are deleted; the companies and users go
  through `destroyRecords` (`fixtures/world.ts`, the world's own cleanup and check), so companies and users pinned by
  audit entries are left archived or deactivated, like the world's.

### Cleanup rules

- Tests change only rows of this run's world, so nothing needs restoring: the world is destroyed at
  teardown. Refused requests are checked against whole-row snapshots (`supabase db query`, local only).
- Rows the tests create themselves (statements, storage objects, communications and approval requests)
  are deleted with the service-role client in the file's `afterAll`, and the deletion is asserted;
  `destroyWorld()` would remove any leftovers inside the world's companies.
- The service-role key is used only for setup and cleanup, never to call the API.
- `audit_logs` is append-only by design: each run adds audit entries (lease verification, monitoring
  status change, approval decision) that are intentionally not removed, and no test asserts global
  audit counts.

## E2E suite

### Prerequisites

1. `pnpm install`.
2. Chromium for Playwright, once per machine: `pnpm --filter @leaseguard/tests e2e:install`.
3. Docker running and the local Supabase stack started with the current migrations (`pnpm db:start`;
   `pnpm exec supabase migration up` applies new ones). The database may be empty.
4. A local Redis on `127.0.0.1:6379` (or set `E2E_REDIS_URL`; it must be local).
5. The document-processing service's virtual environment, once per machine: `pnpm python:setup` (Python 3.14+).
6. Ports 3955 (API), 3957 (document processing) and 5199 (web) free.

### How the environment is chosen

The suite refuses to run unless Supabase is local: the Playwright config reads `supabase status -o env`
(never `backend/.env`) and stops when the URL is not on this machine. Playwright then starts two web
servers and never reuses one that is already running (`reuseExistingServer: false`):

- **API** (`node tests/e2e/support/run-api.ts`): builds `@leaseguard/domain` if stale and compiles the API
  into `backend/.dev-e2e`, then runs `node .dev-e2e/main.js` on port 3955 with an explicit environment
  (local Supabase URL and anon key, `API_CORS_ORIGINS=http://localhost:5199`, a unique `QUEUE_PREFIX`,
  every other variable from `.env.example`). Its log is `tests/test-results/e2e/api.log`. When Playwright
  stops it (SIGTERM), it stops the API, deletes the run's Redis keys and removes `backend/.dev-e2e`.
- **Statement processing**, started by the same runner before the API and stopped with it: the document-processing
  service (`python -m uvicorn app.main:app` from `python-services/document-processing/.venv` on port 3957, a random
  token per run; log `tests/test-results/e2e/document-processing.log`) and the statement worker
  (`e2e/support/statement-worker.ts`: the compiled `statement-processing` and `statement-monitoring` processors from
  `backend/.dev-e2e`, built by hand as `WorkersModule` wires them, on the run's queue prefix with the local
  service-role key; log `tests/test-results/e2e/worker.log`). Nothing else consumes the queues: no daily monitoring
  dispatch, no message delivery, no WhatsApp or invitation jobs, so an approved message still stays queued.
- **Web**: `vite --port 5199 --strictPort` (the frontend's own Vite binary) with `VITE_API_URL=http://127.0.0.1:3955` and the local
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the process environment (they override `frontend/.env`).

`global-setup.ts` creates this run's world with `createWorld` (label `e2e`: unique emails and company
names, random passwords) and destroys it, with a cleanup check, when the run ends. Tests sign in through
the login form as world users. Each test gets a fresh browser context, and tests that change a user work
on a user no other test uses (profile edits: `admin`; password change: `readOnly`), so parallel workers
never interfere. Changed values are restored by the tests themselves (and the world is removed anyway).

### What is covered

| File | Behaviour |
| --- | --- |
| `auth.spec.ts` | signed-out visit redirects to `/login` and returns to the requested page after sign-in; wrong password refused; sign-out protects the app again |
| `app-shell.spec.ts` | dashboard inside the shell with the default workspace; all navigation items and their links; sidebar navigation marks the active item |
| `properties.spec.ts` | the active company's properties sorted by name, sort toggle; search, type filter, clear filters, empty result; paging; opening a property detail |
| `workspace.spec.ts` | a user with two companies switches company (sidebar and account menu), sees only that company's properties, the choice survives a reload; another company's record is "not found in this workspace" |
| `profile.spec.ts` | account menu shows name, email and role; edit profile (`PATCH /me`, invalid WhatsApp refused, clearing a field, restored to the original values); change password by email link (the menu sends the link and shows the resend cooldown; the link is obtained with the service role via `auth.admin.generateLink` type `recovery` with the same `redirectTo`, since local email capture is off; `/auth/reset-password` sets the new password and continues signed in; old password refused, new accepted; restored the same way and signing in again) |
| `not-found.spec.ts` | unknown route shows "Page not found" inside the shell; unknown report id shows "Report not found"; unknown property id shows "Property not found" |
| `whatsapp-integration.spec.ts` | Settings → Integrations → WhatsApp with no Meta settings (the e2e API uses `.env.example`): a company admin sees "Requires Meta configuration or approval" naming each missing setting and its process, three features "Requires configuration", no numbers and nothing "Connected"; the old `/settings/whatsapp` link redirects; a read-only member sees the read-only notice and no connect action; a number stored through `import_whatsapp_number` (the number import, ticket 15; no worker, so it stays pending) shows "Nexus Solution connected this number with the number import", is never shown connected, and its disconnect confirmation and disconnected state point the admin to Nexus Solution |
| `users.spec.ts` | Settings → Users: a company admin's own row shows "You" with role change and removal disabled and explained; invite a user (toast), the same email again is refused on the email field, revoke after confirmation (status Revoked, revoke disabled); a read-only member sees the notice, the member list and no invitations or actions. Invitations it creates are deleted in `afterAll` |
| `statements-acceptance.spec.ts` | Statements acceptance (ticket S-09), PRD §13.3 and the statement side of §13.4, in its own Playwright project after every other spec. Two units, tenants and verified leases are added to the world's property DIP (`fixtures/statement-acceptance.ts`). A property manager uploads two generated statements (`fixtures/sample-statements.ts`) in two source-system layouts, Sage (label and value columns) and PropSys (`Label: value` headings and dated rows); a copy in the same upload is "Repeated in this upload" and the same file in a later upload "Already uploaded", linking to the statement on record, and neither is registered. The worker reads both into review with no arrears event. The review screen shows the original (its short-lived link returns the uploaded bytes), the values read, and flags the additional charges (garbled on the document: missing, left empty) and the total due (no cents: low confidence, not used); the manager enters both (each correction audited with before and after), saves the tenant, unit and lease proposed from the statement and verifies. The figures are saved with the verifier's sign-off; the worker raises the arrears event and the escalation discrepancy (expected R37 800.00, R2 800.00 short), both naming the statement, and closes its review event; no tenant message is created. The Statements page counts that balance only and links to the statement; the PropSys statement stays under review with its uncertain figures flagged and raises nothing. Removed in `afterAll` |

Selectors are roles and accessible names from the UI (`navigation "Main"`, the workspace switcher's
label, the table caption, pagination buttons), not CSS classes. Traces and screenshots of failures are
written to `tests/test-results/e2e/results`.

## Statements acceptance: PRD §13.3 and §13.4 (ticket S-09)

Each §13.3 item and the statement side of §13.4, with the tests that prove it on the local stack. The browser
journey is `e2e/statements-acceptance.spec.ts` (one test, one step per item below); the integration tests call the
API and the worker's processors directly.

| PRD item | Proved by |
| --- | --- |
| PDF statements can be uploaded | e2e journey, steps "upload the Sage statement …" and "upload the PropSys statement …" (two layouts, several files per upload, signed upload URL, queued for processing); `integration/statements.test.ts` (signed URL, upload, register, job queued) |
| Original documents are retained | e2e journey, "the review screen keeps the original …" (the embedded original's short-lived link returns the uploaded bytes, SHA-256 equal); `integration/statement-review.test.ts` (download link for any member) |
| Relevant information can be extracted | e2e journey: tenant, unit, statement number, date, period and figures read by the document-processing service from both layouts, and the extraction's tenant and unit proposal; `python-services/document-processing/tests` (parsers and validators) |
| Uncertain information is flagged | e2e journey: a garbled amount is missing and left empty, an amount without cents is low confidence and not used, figures summed from rows and a balance not printed are flagged; Verify stays disabled until each is resolved |
| Manual corrections can be made | e2e journey, "enter the values …": two corrections through the review screen, each with the corrector's sign-off and an audit entry with before and after; `integration/statement-review.test.ts` (correction and confirmation audit, read-only refused) |
| Duplicate statements can be identified | e2e journey: the same file twice in one upload ("Repeated in this upload") and again in a later upload ("Already uploaded", linking to the statement on record), neither registered; `integration/statements.test.ts` (409 with the existing statement); `integration/statement-verification.test.ts` (mark as duplicate) |
| Verified information is saved correctly | e2e journey, "verify …": number, dates, period, the six figures, tenant, unit, lease, verifier and time on the statement row, the sign-off on the screen; `integration/statement-verification.test.ts` (figures only through verification) |
| Arrears are identified from verified statement information (§13.4) | e2e journey (arrears event after verifying, none before, none for the unverified statement or its tenant; the Statements page counts only the verified balance); `integration/statement-acceptance.test.ts` (uploaded, under review, rejected and duplicate statements raise nothing in the daily scans or the post-verification job); `integration/statement-arrears.test.ts` |
| Monitoring events are traceable to their source data (§13.4) | e2e journey and `integration/statement-acceptance.test.ts`: the arrears event and the escalation discrepancy (R35 000 at 8%: expected R37 800, R2 800 short) name the verified statement, its tenant and lease, with the calculation |

## Monitoring accuracy acceptance: PRD §13.4 (ticket M7-06)

Each §13.4 item, with the §5.7 example it uses and the tests that prove it on the local stack. Unless named otherwise,
the test is `integration/monitoring-acceptance.test.ts`; scenarios are scanned on 02 Nov 2026 (the renewal one on
01 Aug 2027) with the company's default notice periods (expiry 180/90/30 days, renewal 90/60/30, guarantee 90/30).

| PRD item | Example | Proved by |
| --- | --- | --- |
| Escalation calculations are accurate | R35 000.00 a month at 8% a year from 01 Mar 2026, billed R35 000.00 on the verified October 2026 statement: expected R37 800.00, discrepancy R2 800.00 | "escalation …": one `rental_escalation_discrepancy` with expected, billed and difference and each calculation step, naming the statement; also `integration/statement-acceptance.test.ts` and the e2e statements journey (verified through the API and the screens) |
| Lease expiry dates are monitored correctly | Expires 15 Jan 2027: 74 days ahead, the 90-day threshold | "lease expiry …": one `lease_expiry` due on the expiry date, keyed by its threshold |
| Renewal deadlines are calculated correctly | Expires 31 Dec 2027, notice three months before expiry: deadline 30 Sep 2027, warned 60 days ahead | "renewal …": nothing on 02 Nov 2026; on 01 Aug 2027 one `renewal_notice_deadline` due 30 Sep 2027 (and the lease expiry at its 180-day threshold) |
| Guarantee shortfalls are identified correctly | A guarantee of three months of the original R35 000.00 (R105 000.00); after 8% three months are R113 400.00: R8 400.00 short | "guarantee shortfall …": one `guarantee_shortfall` with required, held and shortfall; "guarantee expiry …": a covering guarantee expiring 30 Nov 2026 raises only `guarantee_expiry` at the 30-day threshold |
| Arrears are identified from verified statement information | A verified statement of 30 Sep 2026 with R46 000.00 outstanding: 33 days old, bucket 30 | "arrears …": one `arrears` event with the balance and bucket, naming the statement; "an unverified lease or statement raises nothing": a statement under review raises nothing and `statement-monitoring` skips it; `integration/statement-acceptance.test.ts` (uploaded, under review, rejected and duplicate statements) |
| Monitoring events are traceable to their source data | Every event above | "the API names, for any member, …": each event's detail names its property, unit, tenant, lease (id and reference), assignee, statement (escalation and arrears) and calculation, and the lease is readable; the property manager is notified of every high or critical event with a link to it |
| (§5.7, §6) Unverified lease terms never drive monitoring | A lease pending verification that would trip expiry, renewal, guarantee expiry and shortfall | nothing on either date; the database refuses a financial event on it (`require_verified_lease`); once a manager verifies it through the API the same terms raise exactly those four events |
| (§5.7 A-D, §6.3) No tenant message for escalation, expiry, renewal or guarantee events | Every event above | no communication exists for any tenant of the portfolio after every scan; the database refuses an outbound tenant message of any type but the five statement and payment types (`communications_tenant_message_type_check`) |

Running it found and fixed one gap: arrears events named their lease but not its reference (lease findings did), so
the detail showed no lease reference for them and the list's lease-reference search missed them. The arrears scan now
reads the statement's lease reference with the statement (`backend/src/workers/monitoring/arrears-monitoring.*`).
