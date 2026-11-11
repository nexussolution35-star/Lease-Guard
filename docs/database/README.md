# Database

LeaseGuard uses Supabase: PostgreSQL with Row Level Security (RLS), Supabase Auth and Supabase
Storage. Everything lives in `supabase/`:

| Path | Contents |
| --- | --- |
| `supabase/migrations/*.sql` | Versioned schema, RLS policies, triggers, storage buckets and policies |
| `supabase/tests/*.test.sql` | pgTAP tests |
| `supabase/seed.sql` | Generated local test seed (never edit by hand) |
| `supabase/config.toml` | Local stack configuration (API 54321, Postgres 54322, `auto_expose_new_tables = false`) |

Generated TypeScript types for the backend are in
`backend/src/infrastructure/database/database.types.ts`.

## Migrations

Applied in file-name order. Every schema change is a new migration; existing files are not edited.

| Migration | What it does |
| --- | --- |
| `20261107100000_foundation.sql` | `private` schema (not exposed through the Data API), every enum type (mirroring the `as const` tuples in `packages/domain/src/types`), `private.is_tenant_message_type`, and the generic `set_updated_at` / `prevent_company_change` triggers |
| `20261107100100_companies_and_users.sql` | `companies`, `profiles` (created by a trigger on `auth.users`), `company_users` (memberships with a role per company), `whatsapp_accounts` (non-secret configuration plus an `access_token_reference`), and the membership helpers `private.is_company_member`, `has_company_role`, `can_write`, `shares_company_with` |
| `20261107100200_portfolio.sql` | `properties`, `units`, `tenants`. Every company-owned table has `UNIQUE (company_id, id)` and children reference parents through composite `(company_id, parent_id)` foreign keys, so a row cannot point at another company's parent |
| `20261107100300_leases.sql` | `leases` (escalation, renewal option and deposit as columns), `lease_bank_guarantees`, `lease_documents` |
| `20261107100400_statements.sql` | `statements` (with a unique SHA-256 index over live statements per company), `statement_line_items`, `statement_extractions`, `statement_extraction_fields` (one row per extracted field) |
| `20261107100500_arrangements.sql` | `payment_arrangements` and `arrangement_installments`: records of an agreement, never payments |
| `20261107100600_monitoring.sql` | `monitoring_rules` (config shape validated in SQL), `monitoring_events`, and a trigger requiring a verified lease for financial event types |
| `20261107100700_communications.sql` | `message_templates`, `communications`, `message_approvals`; a CHECK limiting tenants to the five tenant message types; the deferred `tenant_message_requires_approval` constraint trigger |
| `20261107100800_notifications_audit_jobs.sql` | `notifications`, the append-only `audit_logs`, and `job_runs` |
| `20261107100900_audit_triggers.sql` | BEFORE triggers that stamp the acting user from `auth.uid()` and AFTER triggers that append `audit_logs` rows for audited state changes |
| `20261107101000_row_level_security.sql` | RLS on every public table, table privileges and policies |
| `20261107101100_storage.sql` | Private `statements` and `lease-documents` buckets and their per-company object policies |
| `20261109100000_job_run_tracking.sql` | Aligns `job_runs` with the worker's per-attempt records: `skipped` status, `max_attempts`, `will_retry`, `duration_ms`, nullable `company_id` for system-level jobs, dead-letter index |
| `20261109100100_monitoring_dedupe_keys.sql` | `dedupe_key` on `monitoring_events` and `notifications`, unique per company |
| `20261109100200_statement_processing.sql` | `statements.processing_error` and `statement_extractions.issues` |
| `20261109100300_extraction_field_value_default.sql` | Default JSON `null` for `statement_extraction_fields.value`, so the worker can store a field that was not found |
| `20261109100400_guard_dedupe_keys.sql` | `private.guard_dedupe_key` trigger: only background jobs may set or change a dedupe key |
| `20261110100400_whatsapp_business_accounts_and_numbers.sql` | Several WhatsApp Business Accounts and numbers per company: `whatsapp_accounts` renamed `whatsapp_phone_numbers` (unique per company and phone number id; Meta status columns written by the service role only; the credential reference no longer readable by signed-in users), new `whatsapp_business_accounts` (members read; written by the service role and by the trigger that records a number's account). See `docs/integrations/whatsapp.md` |
| `20261110100700_whatsapp_number_verification.sql` | Number verification: `whatsapp_number_verification_steps` and `whatsapp_message_templates` (members read; service role writes), `whatsapp_phone_numbers.registration_blocked_until`, `finish_whatsapp_number_verification` and `sync_whatsapp_message_templates` (service role only), `disconnect_whatsapp_number` (company admins, `SECURITY DEFINER`). See `docs/integrations/whatsapp.md` |
| `20261111100500_whatsapp_number_import.sql` | Number import (ticket 15): `import_whatsapp_number` (service role only, `SECURITY DEFINER`; the operator command `pnpm whatsapp:import-test-number`) stores Nexus Solution's test-number token in Vault for one company and records its account and number pending verification; `whatsapp_phone_numbers.operator_imported_at` (members read); `store_whatsapp_onboarding_token` redefined to clear the stamp and delete an imported token a later signup replaced; `remove_whatsapp_business_account_access` redefined so the admins' notification tells them to have an imported number imported again. See `docs/integrations/whatsapp.md` |
| `20261111100600_audit_company_and_membership_changes.sql` | Audit triggers for company configuration and membership management: `audit_change` on `companies` (one row per update, with the changed profile or settings columns), `audit_role_change` and `audit_removal` on `company_users` (a removal is audited only when a signed-in user did it, not for cascades) |
| `20261111100700_property_management.sql` | Property management: signed-in writers lose DELETE and get column grants (code, company and timestamps fixed after creation); `private.guard_property_change` (manager is a company admin or property manager; an archived property is read-only; no archive while a lease is draft, pending verification, active or expiring; nothing starts archived); `private.audit_property_change` (create, update, archive, restore) |

## Row Level Security model

Defined in `20261107101000_row_level_security.sql`, using the helpers from
`20261107100100_companies_and_users.sql`:

| Helper | True when the signed-in user (`auth.uid()`)… |
| --- | --- |
| `private.is_company_member(company_id)` | has a `company_users` row in the company and an `active` profile |
| `private.has_company_role(company_id, roles)` | is an active member with one of `roles` |
| `private.can_write(company_id)` | has role `company_admin` or `property_manager` |
| `private.shares_company_with(user_id)` | shares at least one company with that user |

The helpers are `SECURITY DEFINER` so policies can read `company_users` without recursing into its
own RLS. Suspending a profile removes access everywhere.

| Tables | Read | Write |
| --- | --- | --- |
| Standard company-owned tables (`properties`, `units`, `tenants`, `leases`, `lease_bank_guarantees`, `lease_documents`, `statements`, `statement_line_items`, `statement_extractions`, `statement_extraction_fields`, `monitoring_rules`, `monitoring_events`, `payment_arrangements`, `arrangement_installments`, `message_templates`) | members | writers insert, update, delete |
| `communications` | members | writers insert and update; no delete |
| `message_approvals` | members | writers request (as themselves) and decide; no delete |
| `companies` | members | `company_admin` updates |
| `company_users` | members | `company_admin` |
| `whatsapp_phone_numbers` | members (every column but `access_token_reference`) | `company_admin` inserts and updates the Meta ids and display fields only; status, Meta's view and the credential reference are service role only; no delete |
| `whatsapp_business_accounts` | members | nobody signed in (the service role, and a trigger when a number is added) |
| `whatsapp_number_verification_steps`, `whatsapp_message_templates` | members | nobody signed in (the worker with the service role); `disconnect_whatsapp_number` for company admins |
| `profiles` | yourself and colleagues | yourself: `full_name`, `phone`, `whatsapp_number`, `job_title` only |
| `notifications` | your own, in companies you belong to | `read` and `read_at` on your own |
| `audit_logs` | `company_admin`, `property_manager`, `read_only` | members append entries for their own actions; nobody updates or deletes |
| `job_runs` | nobody | nobody (RLS on, no policies, no grants) |

- The `anon` role has no privileges on any LeaseGuard table.
- `service_role` bypasses RLS. Only the worker uses it, and it filters by `company_id` itself.
- `prevent_company_change` triggers stop a row from moving to another company.

## Storage

Two private buckets, both limited to 20 MB (20971520 bytes) and `application/pdf`, `image/png`,
`image/jpeg`:

- `statements`: `<company_id>/<statement_id>/<file name>`
- `lease-documents`: `<company_id>/<lease_document_id>/<file name>`

The first path segment decides access (`private.storage_company_id`): members of that company read;
writers upload, replace and delete; a segment that is not a UUID denies access. The table columns that
hold these paths (`statements.storage_path`, `lease_documents.storage_path`,
`communications.attachment_storage_path`) are CHECK-constrained to start with the row's
`company_id`. The backend builds paths with `backend/src/infrastructure/storage/storage-paths.ts`.

## Audit

`audit_logs` is append-only: `private.reject_audit_log_change` rejects every UPDATE, DELETE and
TRUNCATE. Rows are written by:

- **Audit triggers** (`20261107100900_audit_triggers.sql`) on lease verification
  (`leases.verified`), statement verification and changes, extraction review
  (`statement_extractions.status`), field corrections
  (`statement_extraction_fields.corrected_value`), monitoring event status changes and message
  approval decisions. BEFORE triggers stamp the actor from `auth.uid()` so a client cannot forge it;
  when there is no signed-in user (the worker), the supplied actor columns are kept and the audit row
  has no actor.
- **Company and membership triggers** (`20261111100600_audit_company_and_membership_changes.sql`): a
  change to a company's details or monitoring settings (the changed columns, before and after; notice
  days as `180, 90, 30`), a member's role change and a member's removal by a signed-in user.
  Invitations are audited by `20261109101900_company_invitations.sql`.
- **Members** recording their own action (`actor_user_id` must equal `auth.uid()`).

## Product guards in the database

These are the last line of defence; the API and worker check the same rules first through
`@leaseguard/domain`.

- `communications_tenant_message_type_check`: outbound tenant messages may only use the five tenant
  message types.
- `tenant_message_requires_approval` (deferred constraint trigger): an outbound tenant message cannot
  be `approved`, `queued`, `sent`, `delivered` or `read` without an approved governing
  `message_approvals` row, in every company. There is no setting that relaxes it; the former
  `companies.require_approval_for_tenant_messages` column was dropped in
  `20261110100200_tenant_message_approval_always_required.sql`.
- `message_approvals_one_pending_idx`: at most one open approval request per message.
- `guard_message_write` with `private.communication_status_transitions`: every `communications.status`
  change must be a row of the transition table for the writing role (`user` for `authenticated`,
  `system` for `service_role`); the database owner is not restricted. The service role also cannot
  change approved content, change a recorded WhatsApp message id, set or clear
  `send_uncertain_since` without a status change, or record `sent` without a WhatsApp message id.
  Its status and delivery-column writes (`sent_at`, `delivered_at`, `read_at`, `failure_reason`) are
  accepted only when the transaction-local setting `leaseguard.communication_lifecycle` names the
  lifecycle operation the write is; only the lifecycle functions set it, around their one write, and
  the Data API offers no way to set it. This guards against backend code writing around the
  lifecycle; it is not a boundary against a hostile service role.
- `communications_send_uncertain_check`: a `queued` message always records `send_uncertain_since`
  (the claim sets it), and only `queued`, `failed` or `rejected` messages without a provider id can
  carry it. On a `queued` message the value is also the claim's token: `claim_communication`
  returns it to the one winner, `release_communication_claim` requires it, and
  `record_communication_failed` clears the fact of a `queued` message only with it (without it, a
  not-sent failure of a claimed message changes nothing).
- The lifecycle functions (`20261110100300_communication_lifecycle.sql`) are the only writers of
  delivery state: `decide_communication` (authenticated), and `claim_communication`,
  `release_communication_claim`, `record_communication_sent`, `record_communication_failed`,
  `record_communication_provider_status` (service role only). All are SECURITY INVOKER, so RLS, grants,
  audit triggers and the guard apply to them as to a direct write.
- `require_verified_lease`: `rental_escalation_discrepancy`, `guarantee_shortfall` and
  `deposit_shortfall` events must reference a verified lease.

## Worker tables and columns

- **`job_runs`**: one row per finished job attempt, written by the worker through the service role
  (`backend/src/workers/jobs/job-run-recorder.ts`). `status` is `succeeded`, `skipped` (an
  already-processed job id was delivered again) or `failed`; `will_retry` says whether BullMQ retries a
  failed attempt. Failed rows with `will_retry = false` are dead letters (`job_runs_dead_letter_idx`).
  `company_id` is null only for system-level jobs (the daily monitoring dispatch).
- **Dedupe keys**: `monitoring_events.dedupe_key` and `notifications.dedupe_key` are deterministic keys
  of a finding (for example `lease_expiry:<lease id>:<expiry date>:<threshold>`), unique per company
  through the constraints `monitoring_events_company_dedupe_key` and
  `notifications_company_dedupe_key`. The worker inserts with `ON CONFLICT (company_id, dedupe_key) DO
  NOTHING`. Rows created by people keep a null key. A dismissed or resolved event keeps its key, so
  the same finding is not raised again.
- **Dedupe key guard**: `private.guard_dedupe_key` raises `42501` when the `authenticated` role inserts a
  non-null key or changes a key. The service role is not restricted.
- **Statement processing**: `statements.processing_error` records why extraction could not produce a
  proposal (the statement stays `review_required`); `statement_extractions.issues` holds the issues
  reported by the document-processing service.

## Local seed

Being removed: the database is the only source of truth and local development starts from an empty
database. The integration and E2E suites create (and delete) all the data they need at runtime.

## Tests (pgTAP)

```sh
pnpm db:test                 # supabase test db, against the local stack
```

Run after the seed is loaded; the tests use seeded users.

| File | Covers |
| --- | --- |
| `company_isolation.test.sql` | RLS isolation per company and role, anon has no access, `job_runs` closed, cross-company composite foreign keys, read-only and owner roles cannot write |
| `audited_rules.test.sql` | Audit rows for audited changes, actor stamping, append-only audit log, database-level product guards |
| `property_management.test.sql` | Property create, edit, archive and restore: column grants, no hard delete, manager role, archive rule, read-only archived property, audit rows, other roles and companies |
| `company_and_membership_audit.test.sql` | Audit rows for company details, monitoring settings, role changes and member removal; nothing recorded for refused or no-op updates, other companies or cascades |
| `worker_idempotency.test.sql` | Dedupe-key constraints, `job_runs` tracking columns, statement-processing columns |
| `dedupe_key_guard.test.sql` | Writers can create and update events but never set or change a dedupe key |

## Database types

```sh
pnpm db:types                # regenerate backend/src/infrastructure/database/database.types.ts
pnpm db:types:check          # exit 1 if the committed file is out of date
```

Both run `infrastructure/scripts/generate-db-types.mjs`, which calls the repository's Supabase CLI
(`supabase gen types typescript --schema public`) against the **local** database. Start the stack and
apply migrations first. Commit the regenerated file with the migration.

## Applying migrations to a hosted project

The hosted project named by `SUPABASE_URL` in the root `.env` is the system of record. Apply
migrations to it with:

```sh
pnpm db:push:remote                    # dry run: lists the migrations that would be applied
pnpm db:push:remote -- --apply         # lists them, asks for confirmation, then applies them
pnpm db:push:remote -- --apply --yes   # applies without asking (non-interactive use)
```

`infrastructure/scripts/db-push-remote.mjs` connects with `SUPABASE_DB_PASSWORD` (tooling only; no
application process reads it), never prints it and refuses `--include-seed`. It uses the pinned Supabase
CLI 3, where `db push` targets the local database unless `--remote` is given; with a logged-in CLI you
can instead `pnpm exec supabase link --project-ref <project-ref>` and `pnpm exec supabase db push --remote`.

The default connection is the direct host `db.<project-ref>.supabase.co`, which resolves to IPv6 only.
On an IPv4-only network or container, set `SUPABASE_DB_POOLER_URL` (tooling only) to the session-pooler
connection string from the dashboard (Connect > Session pooler):
`postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
Keep the `[YOUR-PASSWORD]` placeholder; the script substitutes `SUPABASE_DB_PASSWORD`. It refuses a
pooler URL for another project (the user must be `postgres.<project-ref>` of `SUPABASE_URL`), a host
outside `*.pooler.supabase.com`, or the transaction pooler (port 6543).

- Never pass `--include-seed`, and never run `supabase/seed.sql` against a hosted project: it contains
  demo users with a published password.
- Apply migrations before rolling out API and worker versions that depend on them.
- Check which project your root `.env` points at before running anything (see
  [local setup](../development/local-setup.md#which-supabase-am-i-using)).
