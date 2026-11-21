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
| `20261121074800_statement_extracted_facts.sql` | Statement facts from the document (S-01): `extraction_field_name` gains `statement_number` and `opening_balance`; `statements.statement_date`, `period_start` and `period_end` nullable (the uploader need not type them), required once verified (`statements_verified_dates_check`), a period known whole (`statements_period_known_check`); `private.audit_statement_change` also records the statement number, date and period |
| `20261121093317_statement_uploads.sql` | Statement uploads (S-03): signed-in writers get column grants for INSERT on `statements` (the upload's own columns: never `status`, figures, verifier, processing error, duplicate link, delivery or upload time, so a new statement is always `uploaded` with no figures); `private.guard_statement_upload` (42501 first for a caller who cannot write the company; uploader and time stamped from `auth.uid()` and `now()`); `private.audit_statement_upload` (`upload` on entity `statement` with property, file name, source system, SHA-256 and `upload_batch_id`); `statements_upload_batch_id_check` (1 to 100 characters) and `statements_upload_batch_idx` for following one upload batch |
| `20261121110412_statement_review.sql` | Statement review (S-04): `statement_extraction_fields.confirmed_by_user_id`, `confirmed_at` and `corrected_at` (confirmed and corrected are exclusive; a value that was not found cannot be confirmed); `private.guard_extraction_field_review` (every role: a field changes only while the extraction is `pending_review` and the statement `review_required`, P0001 otherwise); `private.stamp_extraction_field_review` (who and when from `auth.uid()` and `now()`; a correction clears a confirmation) replaces `stamp_field_correction`; `private.audit_extraction_field_review` (one row per correction or confirmation with the effective value before and after, a confirmation as `verify`) replaces `audit_field_correction`; `private.guard_statement_match` (every role: tenant, unit and lease fixed once a statement is verified, rejected or a duplicate); `private.audit_statement_change` also records `tenantId`, `unitId` and `leaseId`; signed-in callers lose UPDATE (bar the review columns) and DELETE on `statements`, every write on `statement_line_items`, and all but UPDATE of `status`/`review_notes` on `statement_extractions` and of `corrected_value`/`confirmed_at` on `statement_extraction_fields` (the worker writes them with the service role) |
| `20261121141736_statement_verification.sql` | Statement outcome (S-05): `statements.rejection_reason` (only on a rejected statement, 1 to 1000 characters); signed-in callers keep UPDATE of `tenant_id`, `unit_id`, `lease_id`, `status` and `processing_error` only, so figures, number, date, period and the duplicate link are never written directly; `private.guard_statement_outcome` (signed-in callers: no direct status change into or out of `verified`, `rejected` or `duplicate`, 42501); SECURITY DEFINER `public.verify_statement` (writer check; every field resolved and tenant, unit and lease set, 23514 listing each reason; writes the reviewed values and stamps the verifier; extraction `confirmed` or `corrected`; resolves the `statement_review_required` event), `public.reject_statement` (with a reason) and `public.mark_statement_duplicate` (another live statement of the company); P0001 when the statement is not under review (the API answers 409); `private.audit_statement_change` also records `rejectionReason` and `duplicateOfStatementId` (a duplicate is audited as `reject`) |
| `20261121183305_extraction_field_missing_value.sql` | Statements acceptance (S-09): `private.default_extraction_field_value` (BEFORE INSERT on `statement_extraction_fields`) stores a NULL `value` as JSON `null`. The 20261109100300 default only applied when `value` was left out of the column list, but the worker's bulk upsert always names it (supabase-js sends the union of the rows' keys) and PostgREST 16.5 then sends SQL NULL even with `missing=default`, so every statement with a value that was not found failed processing. A missing value must still be flagged (`statement_extraction_fields_missing_flagged_check`) |
| `20261121194500_statement_review_integrity.sql` | Statements acceptance findings: the statement number is optional. `statement_extraction_fields_confirm_value_check` now lets a `statement_number` without a value be confirmed, which records that the statement prints no number (stamped by `stamp_extraction_field_review`, audited by `private.audit_extraction_field_review` as `verify` with the summary "Confirmed that statement_number is not on the statement"); nothing is filled in and every other field still needs a value. Signed-in callers lose UPDATE on `statement_extractions` (status and review notes change only through the outcome functions) and keep UPDATE of `tenant_id`, `unit_id` and `lease_id` only on `statements` (status and processing error are written by the worker with the service role and by `public.retry_statement_processing`). SECURITY DEFINER `public.retry_statement_processing` (writer check, 42501; null outside the company; P0001 unless `review_required` with a processing error) puts a failed statement back to `uploaded` with the error cleared. `public.verify_statement` also accepts a number confirmed as not on the statement (the verified `statement_number` stays null) and refuses, in the same 23514 list, a reviewed period that ends before it starts and a lease that was not in force on the reviewed statement date (a draft lease never is), since a writer can set the lease directly |
| `20261109100400_guard_dedupe_keys.sql` | `private.guard_dedupe_key` trigger: only background jobs may set or change a dedupe key |
| `20261110100400_whatsapp_business_accounts_and_numbers.sql` | Several WhatsApp Business Accounts and numbers per company: `whatsapp_accounts` renamed `whatsapp_phone_numbers` (unique per company and phone number id; Meta status columns written by the service role only; the credential reference no longer readable by signed-in users), new `whatsapp_business_accounts` (members read; written by the service role and by the trigger that records a number's account). See `docs/integrations/whatsapp.md` |
| `20261110100700_whatsapp_number_verification.sql` | Number verification: `whatsapp_number_verification_steps` and `whatsapp_message_templates` (members read; service role writes), `whatsapp_phone_numbers.registration_blocked_until`, `finish_whatsapp_number_verification` and `sync_whatsapp_message_templates` (service role only), `disconnect_whatsapp_number` (company admins, `SECURITY DEFINER`). See `docs/integrations/whatsapp.md` |
| `20261111100500_whatsapp_number_import.sql` | Number import (ticket 15): `import_whatsapp_number` (service role only, `SECURITY DEFINER`; the operator command `pnpm whatsapp:import-test-number`) stores Nexus Solution's test-number token in Vault for one company and records its account and number pending verification; `whatsapp_phone_numbers.operator_imported_at` (members read); `store_whatsapp_onboarding_token` redefined to clear the stamp and delete an imported token a later signup replaced; `remove_whatsapp_business_account_access` redefined so the admins' notification tells them to have an imported number imported again. See `docs/integrations/whatsapp.md` |
| `20261111100600_audit_company_and_membership_changes.sql` | Audit triggers for company configuration and membership management: `audit_change` on `companies` (one row per update, with the changed profile or settings columns), `audit_role_change` and `audit_removal` on `company_users` (a removal is audited only when a signed-in user did it, not for cascades) |
| `20261111100700_property_management.sql` | Property management: signed-in writers lose DELETE and get column grants (code, company and timestamps fixed after creation); `private.guard_property_change` (manager is a company admin or property manager; an archived property is read-only; no archive while a lease is draft, pending verification, active or expiring; nothing starts archived); `private.audit_property_change` (create, update, archive, restore) |
| `20261120230500_portfolio_imports.sql` | Portfolio import (ticket I-01): `portfolio_imports` (one uploaded CSV or XLSX file: scope, file details, sheet or separator, column headings, row count; uploader and time stamped from `auth.uid()` by `private.guard_portfolio_import`, which also refuses units for an archived property) and `portfolio_import_rows` (cells in column order); `create_portfolio_import` and `replace_portfolio_import_sheet` (SECURITY INVOKER) write a batch and its rows in one transaction; `private.audit_portfolio_import` (`upload`, and `update` on a sheet change); entity type `portfolio_import`; the private `portfolio-imports` bucket (5 MB, CSV and XLSX; members read, writers upload, no replace or delete). Members read; writers insert; nobody signed in deletes a batch |
| `20261121001814_portfolio_import_mappings.sql` | Portfolio import column mappings (ticket I-02): `portfolio_imports.column_mapping` (the mapping applied to the batch, `{"<field>": "<column>"}`; cleared by `private.reset_portfolio_import_mapping` when another sheet changes the columns) and `portfolio_import_mappings` (the company's last mapping per scope and heading signature, a SHA-256 of the normalised headings; saver stamped from `auth.uid()`); `save_portfolio_import_mapping` (SECURITY INVOKER) applies and saves in one transaction; `private.audit_portfolio_import` also records an applied mapping (`update`). The row preview is computed by the API and never stored |
| `20261121014523_portfolio_import_row_resolutions.sql` | Portfolio import row fixes (ticket I-03): `portfolio_import_rows.corrections` (`{"<field>": "<value>"}`, read instead of the file's cells), `skipped`, `linked_property_id` and `linked_unit_id` (composite FKs to the company's properties and units, set null on delete), `changed_by_user_id` and `changed_at` (stamped from `auth.uid()`); `private.guard_portfolio_import_row_change` (a linked unit is of the linked property, or of the batch's property for a units batch, which links no property); `private.audit_portfolio_import_row_change` (one `update` on the batch per change, with the row number and each previous and new value: a correction's previous value is the file's cell under the applied mapping, or the earlier correction). Signed-in writers may update only the four fix columns (`writers_update` policy); the cells stay as read |
| `20261121034217_portfolio_import_apply.sql` | Portfolio import approval (ticket I-04): `apply_portfolio_import` (SECURITY INVOKER) inserts the API's planned properties and units into `properties` and `units` (same column grants, RLS, guards and audit triggers as the forms) and stamps `portfolio_imports.approved_by_user_id` / `approved_at`, in one transaction; the transaction-local settings `leaseguard.portfolio_import_id` / `leaseguard.portfolio_import_row` (set only by that function, cleared on return; the Data API cannot set them) mark each insert, so `private.audit_property_change` / `audit_unit_change` record it as created by import with the batch reference and row, and `record_portfolio_import` triggers list it in `portfolio_import_records`; `guard_approval` refuses an approval stamped outside the function (42501); the batch's audit records the approval (`approve`, with the counts). Unique property codes and unit numbers refuse a second copy, so a repeated approval creates nothing |
| `20261121050512_portfolio_import_tenants.sql` | Tenants from the register (ticket I-05): `tenants.account_reference` (the tenant's code in the company's own system; unique per company whatever its case, writable like the other tenant columns, audited); `portfolio_import_rows.linked_tenant_id` / `tenant_suggestions_rejected` (the manager's decision on a suggested tenant: the existing tenant it is, or "none of these"; never both), stamped and audited by the row guard and audit; `portfolio_import_records` also lists `tenant` records with their `tenant_id` and unit (one per tenant and one per batch row); `apply_portfolio_import` takes `p_tenants` (default `[]`): each tenant is inserted into `tenants` (same grants, RLS and triggers as the tenant form) as the tenant of an existing unit or one the same call creates, its WhatsApp number unvalidated; `private.audit_tenant_change` records it as created by import with the batch reference and row, and the approval's audit counts the tenants created. Nothing writes communications |
| `20261120233210_portfolio_import_google_sheets.sql` | Portfolio import from a Google Sheets link (ticket I-06): `portfolio_imports.google_spreadsheet_id` and `google_sheet_gid` (the sheet and tab read; the tab is null for the first tab), only on a CSV batch, ids only (CHECK-constrained, never a URL); `create_portfolio_import` takes them as two optional arguments. The CSV read is the batch's stored file, so the batch is reproducible when the sheet changes |
| `20261111100800_property_guard_hardening.sql` | `private.guard_property_change` tightened: an archived property can only be restored to active, with no other change in the same write; a signed-in caller who cannot write the target company is refused (42501) before any lookup, so other companies' member roles cannot be probed |
| `20261120143700_lease_list_tenant_search.sql` | `public.tenant_search_text(leases)`: SECURITY INVOKER computed field holding the lease tenant's trading and legal names, so the lease list search can match tenants in a PostgREST `or` filter; execute for `authenticated` and `service_role` only |
| `20261120225800_tenant_management.sql` | Tenant management: signed-in writers lose DELETE and get column grants (company and timestamps fixed; `whatsapp_verified` and `whatsapp_opted_out` not writable by signed-in users); `private.reset_tenant_whatsapp_validation` (a changed WhatsApp number is unvalidated again, for every role, unless the same write sets the flag itself); `private.audit_tenant_change` (create and update; a number change is summarised as needing validation again) |
| `20261120232243_tenant_whatsapp_validation.sql` | Validating a tenant's WhatsApp number (M4-03): `tenants.whatsapp_validated_at` and `whatsapp_validated_by_user_id` (profiles, set null on delete; only set while `whatsapp_verified`, a CHECK), stamped by `private.stamp_tenant_whatsapp_validation` when the flag turns on and cleared whenever it turns off, including the reset after a number change; `public.validate_tenant_whatsapp_number(company, tenant, number)` (`SECURITY DEFINER`, writers only, 42501 otherwise) validates only the number still on record (`validated`, `already_validated`, `number_changed`, `not_found`); `private.audit_tenant_change` redefined so a validation is audited as `verify` |
| `20261120151342_unit_management.sql` | Unit management: signed-in writers lose DELETE and get column grants (company and property fixed after creation; the current tenant and lease, derived from the active lease, not writable); `private.guard_unit_change` (no unit added to, and no change to the units of, an archived property; a unit with a current lease stays occupied; a caller who cannot write the company is refused with 42501 first); `private.audit_unit_change` (create and update; an occupancy-only change is summarised as such) |
| `20261121021500_lease_documents.sql` | Lease documents (M5-02): signed-in writers lose UPDATE and DELETE on `lease_documents` and get column grants for INSERT (the uploader column is overwritten); CHECKs: PDF only, at most 20 MB, the path's second segment is the document id, title and file name lengths; `private.guard_lease_document` (a caller who cannot write the company is refused with 42501 first; the uploader and time are stamped from `auth.uid()`; a signed-in caller records only a file that is in the bucket, P0001 otherwise); `private.audit_lease_document` (`upload` on entity `lease_document`, with the lease reference); the `lease-documents` bucket is PDF only, and the shared `leaseguard_writers_update` / `leaseguard_writers_delete` storage policies now cover the `statements` bucket only, so a lease document's file is never replaced or removed by a signed-in user |
| `20261121003917_lease_management.sql` | Lease management (M5-01): signed-in writers lose DELETE on `leases` and get column grants on `leases` and `lease_bank_guarantees` (company, timestamps and verifier fixed; a lease is never inserted verified); `private.guard_lease_change` (tenant, property and unit in the company and the unit in the property, in words; no lease added to or moved onto an archived property; parties fixed once statements, arrangements, monitoring events, messages or the unit's current lease name the lease; 42501 first for a caller who cannot write the company); `private.reset_lease_verification` (every role: a changed term, `private.lease_term_columns`, unverifies a verified lease and returns active or expiring to pending verification, even when the same write sets `verified`); `private.audit_lease_change` (create and update; a reset is summarised as such); `private.guarantee_change` (guarantee added, changed or removed is audited on the lease and, for signed-in users, unverifies it); `public.save_lease` (SECURITY INVOKER) writes a lease and its guarantee in one transaction |
| `20261121090000_lease_status_and_import_row_integrity.sql` | Integrity fixes: `leases_live_status_verified_check` (a lease is `active` or `expiring` only when `verified`, so a direct Data API write cannot show unverified terms as in force); signed-in users lose DELETE and the `writers_delete` policy on `portfolio_import_rows`, and `replace_portfolio_import_sheet` becomes `SECURITY DEFINER` (writers of the company only, 42501 otherwise) so re-reading a worksheet is the only way rows are removed, and it stays audited on the batch |
| `20261121210000_unit_tenant_assignments.sql` | Assigning a tenant to a unit without a lease (M4-04): `unit_tenant_assignments` (tenant, unit and its property through composite keys, `assigned_at`/`assigned_by_user_id`, `ended_at`/`ended_by_user_id`; current while `ended_at` is null, one current per unit by a partial unique index, a tenant may hold several units; ended rows kept as history). Members read; signed-in callers never write the table: `public.assign_tenant_to_unit` and `public.end_unit_tenant_assignment` (SECURITY DEFINER, writers only, 42501 otherwise; assigning the holder again returns the current assignment) are the only write path. `private.guard_unit_tenant_assignment` (every role: tenant and unit of the company, P0002 otherwise; property not archived; the unit not let to another tenant, by its current lease or an active or expiring lease, nor assigned to another, P0001 naming who holds it; tenant, unit and start fixed; an ended assignment stays ended; who and when stamped from `auth.uid()`); `private.sync_unit_with_assignment` (assigning marks the unit occupied; unassigning returns it to vacant unless a lease keeps it occupied); `units.current_tenant_id` is now the current lease's tenant, else the assigned tenant (`private.derive_unit_current_tenant`, every role; `units_current_pair_check` replaced by `units_current_lease_tenant_check`); `private.guard_assigned_unit_occupancy` (an assigned unit stays occupied); `private.guard_lease_unit_assignment` (every role: a lease of an assigned unit is for the assigned tenant on create, on a change of tenant or unit, and when it becomes active or expiring); both guards lock the unit row (`for update` / `for no key update`), so an assignment and a lease of the unit written at the same time run one after the other and neither misses the other; `private.audit_unit_tenant_assignment` (assign and unassign audited as `update` on the unit, with the tenant, tenant id, property and assignment). Nothing writes monitoring events or communications |
| `20261121223100_payment_arrangement_writes.sql` | Recording payment arrangements (M7-03): signed-in users lose INSERT, UPDATE and DELETE (and the writer policies) on `payment_arrangements` and `arrangement_installments`; members still read. Writers record, edit, close and cancel through `record_payment_arrangement`, `update_payment_arrangement`, `close_payment_arrangement` and `record_arrangement_installment_outcome` (SECURITY DEFINER, `can_write`, 42501 otherwise). The lease is the one given or the tenant's single lease in force at the property (and unit). The schedule is generated by `private.arrangement_schedule` (the same as `generateInstallmentSchedule`: the agreed amount, the last the remainder; weekly +7, fortnightly +14 days, monthly keeps the day clamped to the month end) and the terms are checked in words by `private.arrangement_terms_problem` (22023: positive balance and instalment, instalment at most the balance, at most 260 instalments, agreed on or before today in Johannesburg, first instalment on or after the agreement, a given final date equal to the schedule's). `private.guard_payment_arrangement` (every role): one active arrangement per tenant (in words, and the partial unique index `payment_arrangements_one_active_per_tenant_key`); tenant, property, unit, lease and who agreed it fixed; a closed arrangement (completed, defaulted, cancelled) read-only; proposed -> active or cancelled, active -> completed, defaulted or cancelled; closing stamps `closed_on` and, for a signed-in caller, `closed_by_user_id`. New columns `payment_arrangements.closed_by_user_id`, `close_reason` (required to cancel) and `arrangement_installments.outcome_recorded_by_user_id`, `outcome_recorded_at`. The terms change only while no instalment outcome (paid, missed, waived) is recorded; the schedule is then generated again. A future instalment cannot be recorded as missed. `private.audit_payment_arrangement` and `private.audit_arrangement_installment` audit every change on the arrangement. Nothing here writes a communication or a monitoring event |
| `20261122003000_monitoring_event_status_history.sql` | Monitoring event history (M7-02): `private.audit_event_status` (the audit row of every status change) now also records the `resolution_notes` and `dismissal_reason` as field changes when the same update changed them, after the status change, so the event's history shows the note given with each move. The summary text is unchanged; the trigger still fires only on a status change |
| `20261121234500_message_template_mappings.sql` | Settings → Message templates (SG-01): `whatsapp_message_templates` gains `body` (Meta's BODY text) and `header_format` (DOCUMENT carries the statement PDF), stored by `sync_whatsapp_message_templates` (redefined, same grants and status mapping); `message_type_templates` (one row per company and templated message type, pointing at its `message_templates` row; a template sends one type; `inbound_reply` and `manual` are never templated; who and when stamped from `auth.uid()`). Members read; signed-in callers no longer write `message_templates` (INSERT, UPDATE, DELETE and the writer policies withdrawn) nor the mapping: `public.set_message_type_template` (SECURITY DEFINER, company admins only, 42501 otherwise) copies a synced Meta template into `message_templates` and maps the type, refusing in words (P0001) a template Meta has not approved, an authentication template, a non-Utility template for a tenant type, one without text, with named or gapped placeholders, with banking details or (tenant) a forbidden topic, or already sending another type; 22023 for an untemplated type, P0002 for another company's template. `message_templates.language` accepts Meta's codes (1 to 20 characters). `private.guard_message_template` (every role, 23514): no banking details and, for the tenant audience, no escalation, lease expiry, renewal, dispute, guarantee or deposit wording (`private.template_content_problem`, mirroring `checkOutboundMessage` of @leaseguard/domain); a mapped template's message type is fixed. `private.audit_message_type_template`: choosing a template is audited on the template (`Monthly statement now sent with WhatsApp template … (en_ZA)`, the template before and after). Nothing here sends a message |

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
| Standard company-owned tables (`properties`, `units`, `tenants` and `leases` with the column grants and no delete described under Migrations, `lease_bank_guarantees` (column grants), `statements`, `statement_line_items`, `statement_extractions`, `statement_extraction_fields` (column grants, see `20261121093317_statement_uploads.sql`, `20261121110412_statement_review.sql` and `20261121141736_statement_verification.sql`), `monitoring_rules`, `monitoring_events`, `message_templates`) | members | writers insert, update, delete |
| `lease_documents` | members | writers insert (columns by grant; the uploader is stamped and the file must be in the bucket); no update or delete |
| `portfolio_imports`, `portfolio_import_rows` | members | writers insert (batch columns by grant; the uploader is stamped), change the sheet through `replace_portfolio_import_sheet` and the mapping through `save_portfolio_import_mapping`; no delete of a batch or of its rows |
| `portfolio_import_mappings` | members | writers insert and update the mapping (the saver is stamped); no delete |
| `unit_tenant_assignments` | members | nobody signed in writes it: writers assign and unassign through `assign_tenant_to_unit` and `end_unit_tenant_assignment` |
| `payment_arrangements`, `arrangement_installments` | members | nobody signed in writes them: writers record, edit, close and cancel through `record_payment_arrangement`, `update_payment_arrangement`, `close_payment_arrangement` and record instalment outcomes through `record_arrangement_installment_outcome` |
| `message_templates`, `message_type_templates` | members | nobody signed in writes them: company admins choose the template of a message type through `set_message_type_template` |
| `portfolio_import_records` | members | nobody signed in writes it: a trigger on `properties`, `units` and `tenants` records each insert made while `apply_portfolio_import` runs |
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

Two private buckets, both limited to 20 MB (20971520 bytes): `statements` accepts `application/pdf`, `image/png` and
`image/jpeg`; `lease-documents` accepts `application/pdf` only (`20261121021500_lease_documents.sql`):

- `statements`: `<company_id>/<statement_id>/<file name>`
- `lease-documents`: `<company_id>/<lease_document_id>/<file name>`

The first path segment decides access (`private.storage_company_id`): members of that company read;
writers upload; writers replace and delete statement files only (a lease document's file is kept as recorded); a
segment that is not a UUID denies access. The table columns that
hold these paths (`statements.storage_path`, `lease_documents.storage_path`,
`communications.attachment_storage_path`, `portfolio_imports.storage_path`) are CHECK-constrained to start with the row's
`company_id`. The backend builds paths with `backend/src/infrastructure/storage/storage-paths.ts`.

`portfolio-imports` (`20261120230500_portfolio_imports.sql`): `<company_id>/<import_id>/<file name>`, 5 MB,
`text/csv` and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Members read and
writers upload; there is no update or delete policy, so the original file of a batch is kept.

## Audit

`audit_logs` is append-only: `private.reject_audit_log_change` rejects every UPDATE, DELETE and
TRUNCATE. Rows are written by:

- **Audit triggers** (`20261107100900_audit_triggers.sql`) on lease verification
  (`leases.verified`), statement verification and changes, extraction review
  (`statement_extractions.status`), field corrections and confirmations
  (`statement_extraction_fields.corrected_value`, `confirmed_at`; `20261121110412_statement_review.sql`), statement uploads
  (`20261121093317_statement_uploads.sql`), statement verification, rejection and marking as a duplicate (`20261121141736_statement_verification.sql`), monitoring event status changes and message
  approval decisions. BEFORE triggers stamp the actor from `auth.uid()` so a client cannot forge it;
  when there is no signed-in user (the worker), the supplied actor columns are kept and the audit row
  has no actor.
- **Property and unit triggers** (`20261111100700_property_management.sql`, `20261120151342_unit_management.sql`):
  property create, edit, archive and restore; unit create and edit, with occupancy status changes summarised as such.
- **Tenant triggers** (`20261120225800_tenant_management.sql`): tenant create and edit; a WhatsApp number change
  records the old and new number and the validation reset.
- **Unit assignment triggers** (`20261121210000_unit_tenant_assignments.sql`): assigning a tenant to a unit and
  unassigning it, each an `update` on the unit (`Kasi Flame Grill assigned to unit S02 in Maponya Square`) with the
  tenant, tenant id, property and assignment; the occupancy change it causes is audited by the unit trigger.
- **Payment arrangement triggers** (`20261121223100_payment_arrangement_writes.sql`): recording (`create`, `Payment
  arrangement recorded for Kasi Flame Grill under lease WIP-L003`, with the terms), editing (`update`, the changed
  fields before and after), making active, closing as completed or defaulted and cancelling (with the reason), each on
  the arrangement; an instalment outcome recorded or cleared is an `update` on the arrangement (`Instalment 2 of 6 (due
  28 Feb 2026) recorded as missed`) with the instalment, its status before and after and the note.
- **Message template mapping** (`20261121234500_message_template_mappings.sql`): a company admin choosing the
  template of a message type, an `update` on the template (`Monthly statement now sent with WhatsApp template
  monthly_statement (en_ZA)`) with the message type and the template before and after.
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
  reported by the document-processing service. Status and processing error are written by the worker
  (service role) and reset only by `public.retry_statement_processing`
  (`20261121194500_statement_review_integrity.sql`); no signed-in caller writes them directly.
- **Optional statement number** (`20261121194500_statement_review_integrity.sql`): a statement that prints
  no number is verified once a reviewer confirms the `statement_number` field without a value (it is not on
  the statement); the verified statement's `statement_number` is null. No other missing value can be
  confirmed. Mirrors `OPTIONAL_EXTRACTION_FIELDS` in `@leaseguard/domain`.
- **Statement facts** (`20261121074800_statement_extracted_facts.sql`): `statement_number` and
  `opening_balance` are `extraction_field_name` values, stored per extraction with confidence and flag;
  `statements.statement_date`, `period_start` and `period_end` are nullable until the statement is
  verified (`statements_verified_dates_check`), and a period is known whole
  (`statements_period_known_check`); `private.audit_statement_change` also records the number, date and
  period.
- **Statement uploads** (`20261121093317_statement_uploads.sql`): a signed-in caller inserts only an upload's
  own columns, so every new statement starts `uploaded` with no figures; the uploader and upload time are stamped
  from the session, and each registration is audited as an `upload` naming its `upload_batch_id`. The API
  checks the file is in the bucket and computes its SHA-256 before inserting.

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
| `monitoring_event_history.test.sql` | Monitoring event history: one audit row per status change, naming the signed-in actor, carrying the note given with the move (resolution notes) or the dismissal reason, and only the status when the note is unchanged |
| `portfolio_imports.test.sql` | Portfolio import batches: rows stored with the batch, uploader stamped, audit on create and sheet change, no rows refused, units need a property that is not archived, no deletes, read-only and owner roles cannot create, other companies see nothing, private 5 MB bucket |
| `portfolio_import_row_resolutions.test.sql` | Row fixes: correction, skip and link kept on the batch row with the live property untouched, who and when stamped, audit with the file's and the earlier correction's value as previous value, linked unit must be of the linked property, another company's property refused, cells and stamp not writable, units batch links no property, read-only members, owners and other companies cannot change a row |
| `portfolio_import_apply.test.sql` | Import approval: properties and units created through the forms' tables in one call, each listed against the batch with its row and audited as created by import with the batch reference, the approval signed off and audited, a second copy refused (23505) with nothing of the call landing, no approval stamped by hand, the import setting cleared, read-only members refused, no communication created |
| `portfolio_import_tenants.test.sql` | Tenants from the register: the decision on a suggested tenant kept on the batch row, stamped and audited (never confirm and reject together), tenants created with the batch for an existing unit and a new one, listed with their unit and audited as created by import with the batch reference, WhatsApp numbers unvalidated, the approval counting tenants, account references unique per company whatever the case, read-only members refused, no communication created |
| `portfolio_import_mappings.test.sql` | Column mappings: applied to the batch and saved once per heading signature, saver stamped, audit on apply, cleared when another sheet is read, object only, read-only members cannot apply or save, other companies see nothing |
| `portfolio_import_google_sheets.test.sql` | Batches read from a Google Sheet: spreadsheet and tab stored, first tab without a tab id, CSV only, a tab needs its spreadsheet, ids only (no URL), read-only members cannot create one |
| `property_management.test.sql` | Property create, edit, archive and restore: column grants, no hard delete, manager role, archive rule, read-only archived property, audit rows, other roles and companies |
| `unit_tenant_assignments.test.sql` | Assigning a tenant to a unit: writers assign (unit occupied, current tenant, who stamped, audited on the unit with tenant, property and assignment; the holder again returns the same assignment; several units per tenant), conflicts named (assigned to another tenant, let to another tenant under a lease, archived property, another company's tenant or unit), an assigned unit stays occupied, no direct inserts, updates or deletes and no typed current tenant, unassign keeps history and returns the unit to vacant (or occupied for an active lease), ended once, leases of an assigned unit only for the assigned tenant (create, tenant change, activation), read-only members, owners and other companies refused, the partial unique index and the unit row locks that serialise concurrent writes, no communication or monitoring event written |
| `message_template_mappings.test.sql` | Message templates: the sync keeps Meta's text and header format; a company admin chooses an approved Utility template (copied with its text, language, variables, approval and document header; who stamped; audited with before and after), changes it; refused: not approved, marketing for a tenant type, authentication, renewal wording for a tenant type, banking details, no text, gaps, named placeholders, an untemplated type, a template already sending another type, another company's template; property managers, read-only members and direct writes refused; the content guard for every role; a mapped template's type fixed; companies isolated |
| `unit_management.test.sql` | Unit create and edit: column grants (property, company, current tenant and lease), no hard delete, unique number per property, archived property read-only, leased unit stays occupied, audit rows, other roles and companies, the company-change trigger |
| `lease_management.test.sql` | Lease create and edit through `save_lease`: unique reference, tenant, property and unit belong together, no lease on an archived property, never inserted verified, verifier not writable, no hard delete, a changed term or guarantee unverifies a verified lease (a note does not), audit rows, parties of a lease in use fixed, read-only members and other companies refused |
| `tenant_management.test.sql` | Tenant create and edit: column grants (company, WhatsApp validation and opt-out), no hard delete, E.164 check, a changed number is unvalidated (signed-in users and jobs), audit rows, other roles and companies |
| `tenant_whatsapp_validation.test.sql` | Validating a tenant's WhatsApp number: writers only (read-only, owner, anonymous and other companies refused), only the number on record, who and when stamped and not writable directly, `verify` audit once, cleared by a number change |
| `company_and_membership_audit.test.sql` | Audit rows for company details, monitoring settings, role changes and member removal; nothing recorded for refused or no-op updates, other companies or cascades |
| `worker_idempotency.test.sql` | Dedupe-key constraints, `job_runs` tracking columns, statement-processing columns |
| `statement_extracted_facts.test.sql` | Statement number and opening balance as extraction fields; date and period optional until verified, required once verified, a period known whole; number, date and period changes audited |
| `statement_uploads.test.sql` | Uploader stamped from the session; a new statement is `uploaded`; status, figures and upload time not insertable by signed-in users; uploads audited with the batch id; identical live file refused; read-only members cannot register |
| `statement_review.test.sql` | Field confirmation and correction stamped with who and when and audited with before and after; a missing value cannot be confirmed; confirmed and corrected exclusive; no rewriting of the extracted value, the corrector or the verifier, no line-item or field inserts and no deletes by signed-in users; match audited, checked by the lease and unit keys and fixed once verified; fields fixed once reviewed; read-only members change nothing |
| `statement_verification.test.sql` | Verification refused while a field is unresolved or the match is incomplete (every reason listed) or without an extraction; the reviewed values become the number, dates and figures, the verifier is the session user, the extraction and review event close, audited; verified once and never reopened by a signed-in user; no direct figure, date, outcome or duplicate-link writes; rejection needs a reason and keeps it; a duplicate needs another live statement of the company; read-only members and other companies' writers refused |
| `extraction_field_missing_value.test.sql` | One insert stores a missing value (SQL NULL, as the worker's bulk upsert sends it) as JSON `null` beside a found one; a missing value must still be flagged |
| `dedupe_key_guard.test.sql` | Writers can create and update events but never set or change a dedupe key |
| `lease_list_search.test.sql` | The lease tenant-search field: grants, trading and legal names, no match or name across companies |

## Database types

```sh
pnpm db:types                # regenerate backend/src/infrastructure/database/database.types.ts
pnpm db:types:check          # exit 1 if the committed file is out of date
```

Both run `infrastructure/scripts/generate-db-types.mjs`, which calls the repository's Supabase CLI
(`supabase gen types typescript --schema public`) against the **local** database. Start the stack and
apply migrations first. Commit the regenerated file with the migration.

## Applying migrations to a hosted project

The hosted project named by `SUPABASE_URL` in `backend/.env` is the system of record. Apply
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
- Check which project your `backend/.env` points at before running anything (see
  [local setup](../development/local-setup.md#which-supabase-am-i-using)).
