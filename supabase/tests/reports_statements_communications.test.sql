-- Reports: statement processing and communication activity (20261122083000_reports_statements_communications.sql,
-- ticket R-06): the three reporting functions answer every member role of the company with the rows the Statements
-- page, the dashboard and communication analytics count, refuse another company and anonymous callers, and never write.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(18);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_statement_uploads(uuid)', 'EXECUTE'), 'anon may not read statement uploads');
select ok(not has_function_privilege('anon', 'public.reports_statement_review_fields(uuid)', 'EXECUTE'), 'anon may not read review fields');
select ok(not has_function_privilege('anon', 'public.reports_communication_activity(uuid)', 'EXECUTE'), 'anon may not read communication activity');
select is(
  (select count(*)::int from pg_proc where proname in ('reports_statement_uploads', 'reports_statement_review_fields', 'reports_communication_activity')
     and provolatile = 's' and not prosecdef),
  3, 'all three are STABLE (read-only) and SECURITY INVOKER');

-- A processing failure for company A, so the uploads show one (written as the owner, like the worker).
insert into public.statements (id, company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256, source_system, status, uploaded_by_user_id, processing_error, uploaded_at)
values ('70000000-0000-4000-8000-000000000091', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'unreadable.pdf',
  '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000091/unreadable.pdf', 'application/pdf', 4096, repeat('9', 64), 'PropSys',
  'review_required', '10000000-0000-4000-8000-000000000003', 'The PDF could not be read', '2026-11-20 22:30:00+00');

set local role authenticated;

-- A read-only member of company A (Nexus Solution).
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select file_name, property_name, tenant_name, source_system::text, status::text, processing_error, extraction_confidence
    from public.reports_statement_uploads('20000000-0000-4000-8000-000000000001') order by file_name$$,
  $$values ('MSQ-2026-09.pdf'::text, 'Maponya Square'::text, 'Dlamini Cellular'::text, 'MRI'::text, 'verified'::text, null::text, 0.970::numeric),
           ('MSQ-2026-10.pdf', 'Maponya Square', 'Dlamini Cellular', 'MRI', 'review_required', null, 0.620),
           ('unreadable.pdf', 'Maponya Square', null, 'PropSys', 'review_required', 'The PDF could not be read', null)$$,
  'every statement with its names, source, status, processing error and extraction confidence');

select is(
  (select uploaded_on from public.reports_statement_uploads('20000000-0000-4000-8000-000000000001') where file_name = 'unreadable.pdf'),
  '2026-11-21'::date, 'the upload date is the South African calendar date (22:30 UTC is the next day in Johannesburg)');

select is(
  (select count(*) from public.reports_statement_uploads('20000000-0000-4000-8000-000000000001') where status = 'review_required'),
  (select pending_review from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000001')),
  'statements waiting for review equal the dashboard''s pending statement reviews');

select results_eq(
  $$select name::text, flagged, value, corrected_value, confirmed_at from public.reports_statement_review_fields('20000000-0000-4000-8000-000000000001')$$,
  $$values ('tenant_name'::text, false, '"Dlamini Cellular"'::jsonb, null::jsonb, null::timestamptz), ('rental_charged', true, '12000'::jsonb, null, null)$$,
  'the extracted fields of the statements waiting for review only (not the verified statement''s)');

select results_eq(
  $$select communication_id, message_type::text, status::text, counterparty_name, property_name, approval_decision::text, approval_decided_by_agent
    from public.reports_communication_activity('20000000-0000-4000-8000-000000000001') order by communication_id$$,
  $$values ('90000000-0000-4000-8000-000000000001'::uuid, 'overdue_payment_reminder'::text, 'pending_approval'::text, 'Dlamini Cellular'::text, null::text, 'pending'::text, false),
           ('90000000-0000-4000-8000-000000000002', 'monthly_statement', 'delivered', 'Dlamini Cellular', 'Maponya Square', 'approved', false),
           ('90000000-0000-4000-8000-000000000003', 'owner_weekly_summary', 'sent', 'Pieter Botha', null, null, null),
           ('90000000-0000-4000-8000-000000000004', 'inbound_reply', 'received', 'Dlamini Cellular', null, null, null)$$,
  'every message with its counterparty, its property (here from its statement) and its approval');

select is(
  (select count(*) from public.reports_communication_activity('20000000-0000-4000-8000-000000000001') where approval_decision = 'pending'),
  (select count(*) from public.message_approvals where company_id = '20000000-0000-4000-8000-000000000001' and decision = 'pending'),
  'messages waiting for approval equal the dashboard''s pending approvals');

select is(
  (select count(*) from public.reports_communication_activity('20000000-0000-4000-8000-000000000001')
   where channel = 'whatsapp' and direction = 'outbound' and status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  (select outbound_messages from public.communication_analytics('20000000-0000-4000-8000-000000000001', (now() at time zone 'Africa/Johannesburg')::date - 365, (now() at time zone 'Africa/Johannesburg')::date)),
  'outbound messages handed over for sending equal communication analytics'' count');

-- Another company is refused, not answered with zeros.
select throws_ok($$select * from public.reports_statement_uploads('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of company A cannot read company B''s statement uploads');
select throws_ok($$select * from public.reports_statement_review_fields('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its review fields');
select throws_ok($$select * from public.reports_communication_activity('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its communication activity');

-- A property owner of company B reads company B.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select results_eq(
  $$select file_name, status::text from public.reports_statement_uploads('20000000-0000-4000-8000-000000000002')$$,
  $$values ('KGP-2026-10.pdf'::text, 'verified'::text)$$,
  'a property owner of company B reads its statements');
select results_eq(
  $$select communication_id, approval_decision::text from public.reports_communication_activity('20000000-0000-4000-8000-000000000002')$$,
  $$values ('90000000-0000-4000-8000-000000000005'::uuid, 'pending'::text)$$,
  'and its messages, with the one awaiting approval');

-- Anonymous callers are refused.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_statement_uploads('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

-- Nothing is written.
reset role;
select is((select count(*)::int from public.statements where company_id = '20000000-0000-4000-8000-000000000001'), 3, 'the statements are unchanged');

select * from finish();
rollback;
