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
  fixtures/      shared by both suites: world.ts (per-run test data), API process, Redis, local Supabase/SQL helpers, PDF generator, paths
  integration/   vitest.config.ts, global-setup.ts, support/ (clients, row snapshots), *.test.ts
  e2e/           playwright.config.ts, global-setup.ts (world), support/ (run-api.ts, app.ts locators, world.ts), *.spec.ts
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

The suite writes and deletes data, so it never trusts the repository-root `.env` (which may point at a
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
  `.env`, so the root `.env` is never read. The API never receives the service-role key.
- The setup creates this run's world (below), waits for `GET /health/ready`, signs in the world's users
  once through local Supabase Auth (local Auth rate-limits sign-ins) and hands URLs, tokens and the
  world to the tests with Vitest `provide`/`inject`.
- Teardown stops the API, deletes `backend/.dev-integration` and every Redis key under the run's queue
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
| `company-isolation.test.ts` | 403 for a company the caller is not a member of; 400 without/with a bad `X-Company-Id`; another company's ids are 404 even under the caller's own company (RLS plus company filter); a member of both companies only sees the active one |
| `lists.test.ts` | `GET /leases`: paging with stable order, filters, search, sort, 400 for invalid parameters |
| `leases.test.ts` | `read_only` cannot verify (403); a property manager verifies an unverified lease (status becomes `active`, verifier and time stamped); idempotent re-verify |
| `monitoring.test.ts` | `read_only` 403; dismissal needs a reason (400); allowed move `new → under_review` (200); disallowed move `under_review → resolved` (409) |
| `statements.test.ts` | `read_only` 403; registering before uploading is 422; signed upload URL → upload of a generated PDF with the anon key → register (201, job queued) → same file again 409 with the existing statement in `duplicate` |
| `whatsapp-integration.test.ts` | several business accounts and numbers per company (added with the service role, removed in `afterAll`): any member lists their own company's accounts and numbers with statuses; another company's are never listed (403 for a company the caller is not in; a member of both sees only the active company's); through PostgREST with a member's own sign-in another company's rows are invisible and `access_token_reference` is refused (42501); the company resource carries a number summary without the credential reference; capabilities are public-safe (all off with `.env.example`, each missing setting named with its process; 401 without a token) |
| `approvals.test.ts` | on a tenant message the test creates (requested by a property manager): `read_only` 403 and the message stays pending; the requester approves their own request (200, recorded as the approver, exactly one `message-delivery` job in the run's queue prefix); approving again 409 with no second job; rejecting the approved message 409 |
| `users-and-invitations.test.ts` | every member lists company A's members (only A's membership); the active-admin count filter; an admin changing their own role or removing themselves 403; other roles 403; an admin changes another member's role and back; removing a member still named on records 409; invite (email lower-cased, `pending`), duplicate 409, resend, revoke, revoke or resend again 409; inviting an existing member 409; invitations refused to other roles and to a non-member company (403). Invitations it creates are deleted in `afterAll` |
| `whatsapp-acceptance-two-businesses.test.ts` | The acceptance scenario of the WhatsApp work (ticket 14), end to end; see below |
| `whatsapp-test-number-import.test.ts` | The number import (ticket 15): runs the operator command `whatsapp:import-test-number` from this run's build (`backend/.dev-integration/operator/import-whatsapp-test-number.js`) with only its own seven settings, all local (so the root `.env` is never read), against the world's company A. Dry run by default (nothing written), `--apply` refused without a terminal unless `--yes`, an unknown company and a number company B has connected refused (B named), then the import: the token in Vault for A only (never printed, never in the job), the account and number pending verification and marked imported; the worker's real number verification runs in the test process (`support/in-process-worker.ts`, own queue prefix `<run prefix>-import`) against the fake Graph API and connects it; the integration page's API shows it connected with every step passed and `operatorImportedAt`, and B's members never see it; re-running leaves a connected number alone; a newer token replaces the stored one (old secret deleted) and the number is verified again with it. Its rows, Vault secrets and Redis keys are deleted in `afterAll`; worker log `test-results/integration/worker-test-number-import.log` |

### Acceptance scenario: two businesses stay apart

`whatsapp-acceptance-two-businesses.test.ts` runs with the rest of the suite (`pnpm test:integration`; on its own:
`pnpm --filter @leaseguard/tests exec vitest run --config integration/vitest.config.ts whatsapp-acceptance`). Same
prerequisites as the suite (local Supabase, local Redis); nothing else to configure. It takes about a minute.

- **Its own businesses.** It does not use the world: it creates *Atlas Properties* and *Baobab Estates* through the
  operator command `infrastructure/scripts/platform-create-company.mjs` (run with only the local `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `WEB_APP_URL` in its environment, so it never reads the root `.env`; unused initials
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
5. Ports 3955 (API) and 5199 (web) free.

### How the environment is chosen

The suite refuses to run unless Supabase is local: the Playwright config reads `supabase status -o env`
(never the root `.env`) and stops when the URL is not on this machine. Playwright then starts two web
servers and never reuses one that is already running (`reuseExistingServer: false`):

- **API** (`node tests/e2e/support/run-api.ts`): builds `@leaseguard/domain` if stale and compiles the API
  into `backend/.dev-e2e`, then runs `node .dev-e2e/main.js` on port 3955 with an explicit environment
  (local Supabase URL and anon key, `API_CORS_ORIGINS=http://localhost:5199`, a unique `QUEUE_PREFIX`,
  every other variable from `.env.example`). Its log is `tests/test-results/e2e/api.log`. When Playwright
  stops it (SIGTERM), it stops the API, deletes the run's Redis keys and removes `backend/.dev-e2e`.
- **Web**: `vite --port 5199 --strictPort` (the frontend's own Vite binary) with `VITE_API_URL=http://127.0.0.1:3955` and the local
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the process environment (they override the root `.env`).

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

Selectors are roles and accessible names from the UI (`navigation "Main"`, the workspace switcher's
label, the table caption, pagination buttons), not CSS classes. Traces and screenshots of failures are
written to `tests/test-results/e2e/results`.
