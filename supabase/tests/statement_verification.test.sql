-- Statement verification, rejection and marking as a duplicate (PRD module 6, ticket S-05): verification is refused
-- while a field is unresolved or the match is missing (every reason listed), writes the reviewed values as the
-- statement's figures, stamps the verifier, closes the extraction review and the review event; a rejection needs a
-- reason; a duplicate needs another live statement; figures never reach a statement any other way; read-only members
-- are refused; every outcome is audited.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(27);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.statement(p_id uuid) returns public.statements
language sql security definer set search_path = '' as $$ select * from public.statements where id = p_id $$;
create function tests.audit(p_entity_id uuid, p_action text) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id and action = p_action::public.audit_action
$$;
grant execute on all functions in schema tests to authenticated;

-- Statement ...70..02 (review_required, matched to MSQ-L001) has extraction ...71..01 with rental_charged (flagged)
-- and tenant_name. Add the other fields: total_due is flagged, the rest were found without a flag.
insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
select '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', v.name::public.extraction_field_name,
       v.raw, v.value::jsonb, 0.97, v.flagged
from (values
  ('unit_number', 'Shop 12', '"Shop 12"', false),
  ('statement_number', 'ST-2026-10', '"ST-2026-10"', false),
  ('statement_date', '31 Oct 2026', '"2026-10-31"', false),
  ('period_start', '01 Oct 2026', '"2026-10-01"', false),
  ('period_end', '31 Oct 2026', '"2026-10-31"', false),
  ('opening_balance', 'R 0,00', '0', false),
  ('additional_charges', 'R 960,00', '960', false),
  ('payments_received', 'R 0,00', '0', false),
  ('outstanding_balance', 'R 12 960,00', '12960', false),
  ('total_due', 'R 12 960,00', '12960', true)
) as v(name, raw, value, flagged);

-- Its open review event.
insert into public.monitoring_events (company_id, dedupe_key, type, property_id, statement_id, title, description, identified_on, priority, recommended_action, status)
values ('20000000-0000-4000-8000-000000000001', 'statement_review_required:70000000-0000-4000-8000-000000000002', 'statement_review_required',
        '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Review MSQ-2026-10.pdf', 'Flagged values',
        '2026-11-01', 'medium', 'Review the statement', 'new');

-- Two more statements under review (no match, no extraction) for rejection and duplicates.
insert into public.statements (id, company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256, source_system, status, uploaded_by_user_id)
values
  ('70000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'reject-me.pdf',
   '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000011/reject-me.pdf', 'application/pdf', 100, repeat('b', 64), 'MRI', 'review_required', '10000000-0000-4000-8000-000000000003'),
  ('70000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'copy.pdf',
   '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000012/copy.pdf', 'application/pdf', 100, repeat('c', 64), 'MRI', 'review_required', '10000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ read-only members are refused
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a read-only member cannot verify');
select throws_ok(
  $$select public.reject_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'Wrong tenant')$$,
  '42501', null, 'a read-only member cannot reject');
reset role;

-- ------------------------------------------------------------------ a property manager
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  '23514', 'rental_charged is not confirmed or corrected; total_due is not confirmed or corrected',
  'verification is refused while fields are unresolved, listing each one');
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011')$$,
  '23514', 'This statement has no extracted values to verify: process it again.', 'a statement without an extraction cannot be verified');
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'a writer of one company cannot verify another company''s statement');

-- Figures reach a statement only through verification.
select throws_ok(
  $$update public.statements set closing_balance = 1 where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot write a figure');
select throws_ok(
  $$update public.statements set statement_date = '2026-10-30' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'nor the statement date');
select throws_ok(
  $$update public.statements set status = 'rejected' where id = '70000000-0000-4000-8000-000000000011'$$,
  '42501', null, 'nor reject a statement by changing its status (no direct status writes since 20261121194500)');
select throws_ok(
  $$update public.statements set duplicate_of_statement_id = '70000000-0000-4000-8000-000000000001' where id = '70000000-0000-4000-8000-000000000012'$$,
  '42501', null, 'nor link a duplicate directly');

update public.statement_extraction_fields set confirmed_at = now()
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
update public.statement_extraction_fields set corrected_value = '12960'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'total_due';

-- Without the lease the match is incomplete (reset as the service role, which keeps table-wide rights).
reset role;
update public.statements set lease_id = null where id = '70000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  '23514', 'The lease is not set', 'verification is refused while the match is incomplete');
update public.statements set lease_id = '60000000-0000-4000-8000-000000000001' where id = '70000000-0000-4000-8000-000000000002';

select is(public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'),
  '70000000-0000-4000-8000-000000000002'::uuid, 'a fully reviewed, matched statement is verified');
select is(
  (select row(status, statement_number, statement_date, period_start, period_end, opening_balance, rental_charged,
              additional_charges, payments_received, closing_balance, total_due)::text
   from tests.statement('70000000-0000-4000-8000-000000000002')),
  row('verified'::public.statement_status, 'ST-2026-10', '2026-10-31'::date, '2026-10-01'::date, '2026-10-31'::date,
      0::numeric(14,2), 12000::numeric(14,2), 960::numeric(14,2), 0::numeric(14,2), 12960::numeric(14,2), 12960::numeric(14,2))::text,
  'the reviewed values become the statement''s number, dates and figures (outstanding balance as closing balance)');
select is((tests.statement('70000000-0000-4000-8000-000000000002')).verified_by_user_id, '10000000-0000-4000-8000-000000000003'::uuid,
  'the verifier is the signed-in user');
select is(
  (select row(status, reviewed_by_user_id)::text from public.statement_extractions where id = '71000000-0000-4000-8000-000000000001'),
  row('corrected'::public.extraction_status, '10000000-0000-4000-8000-000000000003'::uuid)::text,
  'the extraction review is closed (corrected, since one value was entered)');
select is(
  (select row(status, resolved_by_user_id, resolution_notes)::text from public.monitoring_events
   where statement_id = '70000000-0000-4000-8000-000000000002' and type = 'statement_review_required'),
  row('resolved'::public.monitoring_event_status, '10000000-0000-4000-8000-000000000003'::uuid, 'Statement verified')::text,
  'the statement''s review event is resolved');
select is(
  (select count(*) from tests.audit('70000000-0000-4000-8000-000000000002', 'verify')
   where actor_user_id = '10000000-0000-4000-8000-000000000003'
     and changes @> '[{"field":"status","before":"review_required","after":"verified"},{"field":"closingBalance","before":null,"after":12960}]'),
  1::bigint, 'verification is audited with the figures');
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  'P0001', 'This statement is verified, so it cannot be verified.', 'a statement is verified once');
select throws_ok(
  $$update public.statements set status = 'review_required' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot reopen a verified statement');

-- ------------------------------------------------------------------ reject
select throws_ok(
  $$select public.reject_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', '   ')$$,
  '23514', null, 'a rejection needs a reason');
select is(public.reject_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', ' Not our tenant '),
  '70000000-0000-4000-8000-000000000011'::uuid, 'a statement under review is rejected with a reason');
select is(
  (select row(status, rejection_reason)::text from tests.statement('70000000-0000-4000-8000-000000000011')),
  row('rejected'::public.statement_status, 'Not our tenant')::text, 'the reason is kept with the statement');
select is(
  (select count(*) from tests.audit('70000000-0000-4000-8000-000000000011', 'reject')
   where changes @> '[{"field":"rejectionReason","before":null,"after":"Not our tenant"}]'),
  1::bigint, 'the rejection is audited with its reason');

-- ------------------------------------------------------------------ mark as duplicate
select throws_ok(
  $$select public.mark_statement_duplicate('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '70000000-0000-4000-8000-000000000012')$$,
  '23514', 'A statement cannot be a duplicate of itself.', 'a statement is not a duplicate of itself');
select throws_ok(
  $$select public.mark_statement_duplicate('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '70000000-0000-4000-8000-000000000011')$$,
  '23514', null, 'nor of a rejected statement');
select throws_ok(
  $$select public.mark_statement_duplicate('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '70000000-0000-4000-8000-000000000003')$$,
  '23514', 'The other statement is not in this workspace.', 'nor of another company''s statement');
select is(public.mark_statement_duplicate('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '70000000-0000-4000-8000-000000000001'),
  '70000000-0000-4000-8000-000000000012'::uuid, 'a statement under review is marked as a duplicate of a statement on record');
select is(
  (select count(*) from tests.audit('70000000-0000-4000-8000-000000000012', 'reject')
   where changes @> '[{"field":"status","after":"duplicate"},{"field":"duplicateOfStatementId","after":"70000000-0000-4000-8000-000000000001"}]'),
  1::bigint, 'marking as a duplicate is audited with the other statement');
reset role;

select * from finish();
rollback;
