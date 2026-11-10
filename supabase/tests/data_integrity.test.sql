-- Integrity constraints and indexes from migrations 20261109100900 (list and search indexes),
-- 20261109101200 (lease party consistency), 20261109101300 (communication links match the tenant),
-- 20261109101400 (lifecycle columns) and 20261109101500 (storage path shape).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(34);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Fixture ids (fixtures/two_companies.psql):
--   NS company 20000000-...-0001, property 30000000-...-0001, naledi 10000000-...-0003
--   lease MSQ-L001 60000000-...-0001: tenant 50000000-...-0001, unit 40000000-...-0001
--   lease WIP-L003 60000000-...-0002: tenant 50000000-...-0002, unit 40000000-...-0002
--   statement 70000000-...-0001 (tenant ...0001), arrangement 80000000-...-0001 (tenant ...0001)

-- ------------------------------------------------------------------ indexes
select has_index('public', 'statements', 'statements_company_uploaded_idx', array['company_id', 'uploaded_at'],
  'the default statements list order has an index');
select has_index('public', 'monitoring_events', 'monitoring_events_company_identified_idx', array['company_id', 'identified_on'],
  'the default monitoring list order has an index');
select is((select pg_get_indexdef('public.monitoring_events_company_due_idx'::regclass) ~ ' WHERE '), false,
  'the due date index serves the dueDate sort (not partial)');
select has_index('public', 'audit_logs', 'audit_logs_summary_trgm_idx', 'audit log summary search has a trigram index');
select ok(
  (select count(*) = 2 from pg_indexes where schemaname = 'public' and tablename = 'communications'
     and indexname in ('communications_body_trgm_idx', 'communications_counterparty_number_trgm_idx') and indexdef ~ 'gin_trgm_ops'),
  'both searched communications columns have a trigram index');
select hasnt_index('public', 'leases', 'leases_property_idx', 'the redundant leases_property_idx is gone');

create table tests.msg_base as select
  '20000000-0000-4000-8000-000000000001'::uuid as company_id, 'whatsapp'::public.channel as channel,
  'outbound'::public.message_direction as direction, 'monthly_statement'::public.message_type as message_type,
  'tenant'::public.recipient_type as recipient_type, '+27821110002'::text as counterparty_number,
  '+27115550100'::text as company_number, 'Your statement.'::text as body;
grant select on tests.msg_base to authenticated;

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

-- ------------------------------------------------------------------ lease parties agree
select throws_ok(
  $$insert into public.payment_arrangements (company_id, tenant_id, property_id, unit_id, lease_id, outstanding_balance,
      installment_amount, frequency, first_installment_date, final_installment_date, agreed_by_user_id, agreed_on)
    values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 100, 50, 'monthly', '2026-12-01', '2027-01-01',
      '10000000-0000-4000-8000-000000000003', '2026-11-09')$$,
  '23503', null, 'an arrangement cannot name another tenant than its lease''s');
select throws_ok(
  $$insert into public.statements (company_id, property_id, tenant_id, unit_id, lease_id, file_name, storage_path, mime_type,
      size_bytes, file_sha256, source_system, statement_date, period_start, period_end, uploaded_by_user_id)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('c', 64), 'MRI',
      '2026-11-30', '2026-11-01', '2026-11-30', '10000000-0000-4000-8000-000000000003')$$,
  '23503', null, 'a statement cannot name another unit than its lease''s');
select throws_ok(
  $$insert into public.statements (company_id, property_id, lease_id, file_name, storage_path, mime_type,
      size_bytes, file_sha256, source_system, statement_date, period_start, period_end, uploaded_by_user_id)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('c', 64), 'MRI',
      '2026-11-30', '2026-11-01', '2026-11-30', '10000000-0000-4000-8000-000000000003')$$,
  '23514', null, 'a statement filed against a lease carries the lease''s tenant and unit');
select throws_ok(
  $$insert into public.monitoring_events (company_id, type, property_id, unit_id, tenant_id, lease_id, title, description,
      identified_on, priority, recommended_action)
    values ('20000000-0000-4000-8000-000000000001', 'lease_expiry', '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001',
      'x', 'x', '2026-11-09', 'low', 'x')$$,
  '23503', null, 'a monitoring event cannot name another tenant than its lease''s');
select throws_ok(
  $$insert into public.monitoring_events (company_id, type, property_id, lease_id, title, description,
      identified_on, priority, recommended_action)
    values ('20000000-0000-4000-8000-000000000001', 'lease_expiry', '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001', 'x', 'x', '2026-11-09', 'low', 'x')$$,
  '23514', null, 'a monitoring event that names a lease carries its tenant and unit');
select lives_ok(
  $$insert into public.monitoring_events (company_id, type, property_id, unit_id, tenant_id, lease_id, title, description,
      identified_on, priority, recommended_action)
    values ('20000000-0000-4000-8000-000000000001', 'lease_expiry', '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      'x', 'x', '2026-11-09', 'low', 'x')$$,
  'an event naming the lease''s own tenant and unit is accepted');
select throws_ok(
  $$update public.units set current_tenant_id = '50000000-0000-4000-8000-000000000002'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'a unit''s current tenant must be its current lease''s tenant');
select throws_ok(
  $$update public.units set current_lease_id = null where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a unit sets its current lease and tenant together');
select lives_ok(
  $$update public.units set current_lease_id = null, current_tenant_id = null where id = '40000000-0000-4000-8000-000000000001'$$,
  'a unit can clear its current lease and tenant together');

-- ------------------------------------------------------------------ communication links match the tenant
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, statement_id,
      counterparty_number, company_number, body)
    select company_id, channel, direction, message_type, recipient_type, '50000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000001', counterparty_number, company_number, body from tests.msg_base$$,
  '23503', null, 'a tenant message cannot carry another tenant''s statement');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, arrangement_id,
      counterparty_number, company_number, body)
    select company_id, channel, direction, 'arrangement_installment_reminder', recipient_type, '50000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001', counterparty_number, company_number, body from tests.msg_base$$,
  '23503', null, 'a tenant message cannot carry another tenant''s arrangement');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, lease_id,
      counterparty_number, company_number, body)
    select company_id, channel, direction, message_type, recipient_type, '50000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000001', counterparty_number, company_number, body from tests.msg_base$$,
  '23503', null, 'a tenant message cannot carry another tenant''s lease');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, statement_id,
      counterparty_number, company_number, body, attachment_file_name, attachment_storage_path, attachment_mime_type)
    select company_id, channel, direction, message_type, recipient_type, '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001', counterparty_number, company_number, body, 'other.pdf',
      '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000002/MSQ-2026-10.pdf', 'application/pdf' from tests.msg_base$$,
  '23503', null, 'a statement message attaches that statement''s own file only');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, attachment_file_name, attachment_storage_path, attachment_mime_type)
    select company_id, channel, direction, message_type, recipient_type, '50000000-0000-4000-8000-000000000001',
      counterparty_number, company_number, body, 'x.pdf',
      '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001/MSQ-2026-09.pdf', 'application/pdf' from tests.msg_base$$,
  '23514', null, 'an outbound tenant attachment must belong to a referenced statement');
select lives_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, statement_id,
      counterparty_number, company_number, body, attachment_file_name, attachment_storage_path, attachment_mime_type)
    select company_id, channel, direction, message_type, recipient_type, '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001', counterparty_number, company_number, body, 'MSQ-2026-09.pdf',
      '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001/MSQ-2026-09.pdf', 'application/pdf' from tests.msg_base$$,
  'a statement message to the statement''s own tenant with its own file is accepted');
select lives_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, owner_user_id, statement_id,
      counterparty_number, company_number, body)
    select company_id, channel, direction, 'owner_weekly_summary', 'property_owner', '10000000-0000-4000-8000-000000000005',
      '70000000-0000-4000-8000-000000000001', '+27825501194', company_number, 'Summary' from tests.msg_base$$,
  'an owner message may reference a statement (no tenant to match)');

-- ------------------------------------------------------------------ storage path shape
select throws_ok(
  $$update public.statements set storage_path = '20000000-0000-4000-8000-000000000001/../20000000-0000-4000-8000-000000000002/70000000-0000-4000-8000-000000000003/KGP-2026-10.pdf'
    where id = '70000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a statement path cannot contain a dot-dot segment');
select throws_ok(
  $$update public.statements set storage_path = '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000002/%2e%2e.pdf'
    where id = '70000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a statement path cannot contain percent-encoding');
select throws_ok(
  $$update public.statements set storage_path = '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000002/a/b.pdf'
    where id = '70000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a statement path has exactly three segments');
select throws_ok(
  $$update public.statements set storage_path = '20000000-0000-4000-8000-000000000001/not-a-uuid/b.pdf'
    where id = '70000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'the entity segment is a uuid');
select lives_ok(
  $$update public.statements set storage_path = '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000002/MSQ_2026-10.v2.pdf'
    where id = '70000000-0000-4000-8000-000000000002'$$,
  'a path in the API''s shape is accepted');
select throws_ok(
  $$update public.lease_documents set storage_path = '20000000-0000-4000-8000-000000000001/61000000-0000-4000-8000-000000000001/.hidden'
    where id = '61000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a lease document file name cannot start with a dot');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, owner_user_id,
      counterparty_number, company_number, body, attachment_file_name, attachment_storage_path, attachment_mime_type)
    select company_id, channel, direction, 'owner_weekly_summary', 'property_owner', '10000000-0000-4000-8000-000000000005',
      '+27825501194', company_number, 'Summary', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/../20000000-0000-4000-8000-000000000002/x.pdf', 'application/pdf' from tests.msg_base$$,
  '23514', null, 'a message attachment path cannot contain a dot-dot segment');

-- ------------------------------------------------------------------ lifecycle columns
update public.monitoring_events set status = 'resolved' where lease_reference = 'MSQ-L001' and status = 'new';
update public.monitoring_events set status = 'action_required' where lease_reference = 'MSQ-L001' and status = 'resolved';
select is(
  (select count(*) from public.monitoring_events
   where lease_reference = 'MSQ-L001' and status = 'action_required' and resolved_at is null and resolved_by_user_id is null),
  1::bigint, 'reopening a resolved event clears when and by whom it was resolved');
select throws_ok(
  $$update public.notifications set read = true, read_at = null where user_id = '10000000-0000-4000-8000-000000000003'$$,
  '23514', null, 'a read notification records when it was read');
update public.statements set status = 'review_required', opening_balance = null, rental_charged = null,
  additional_charges = null, payments_received = null, closing_balance = null, total_due = null
where id = '70000000-0000-4000-8000-000000000001';
select is(
  (select row(verified_by_user_id, verified_at)::text from public.statements where id = '70000000-0000-4000-8000-000000000001'),
  row(null::uuid, null::timestamptz)::text,
  'moving a verified statement back clears its verifier');
reset role;

select throws_ok(
  $$insert into public.monitoring_events (company_id, type, property_id, title, description, identified_on, priority,
      recommended_action, status, resolved_by_user_id)
    values ('20000000-0000-4000-8000-000000000001', 'lease_expiry', '30000000-0000-4000-8000-000000000001', 'x', 'x',
      '2026-11-09', 'low', 'x', 'new', '10000000-0000-4000-8000-000000000003')$$,
  '23514', null, 'an open event carries no resolver');
select throws_ok(
  $$insert into public.statements (company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, statement_date, period_start, period_end, uploaded_by_user_id, verified_by_user_id, verified_at)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('d', 64), 'MRI',
      '2026-11-30', '2026-11-01', '2026-11-30', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', now())$$,
  '23514', null, 'an unverified statement carries no verifier');

select * from finish();
rollback;
