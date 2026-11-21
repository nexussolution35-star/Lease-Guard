-- Statement review integrity (20261121194500_statement_review_integrity.sql): a statement that prints no number is
-- verified once a reviewer confirms the number is not on it (stamped and audited, never filled in), while every other
-- missing value must still be entered; verification refuses a period that ends before it starts and a lease that was
-- not in force on the reviewed statement date, listing every reason; a signed-in caller cannot change an extraction's
-- status or review notes, nor a statement's status or processing error, directly; a failed statement is put back to
-- uploaded only through public.retry_statement_processing, by a writer.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(21);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.statement(p_id uuid) returns public.statements
language sql security definer set search_path = '' as $$ select * from public.statements where id = p_id $$;
create function tests.field(p_name text) returns public.statement_extraction_fields
language sql security definer set search_path = '' as $$
  select * from public.statement_extraction_fields
  where extraction_id = '71000000-0000-4000-8000-000000000001' and name = p_name::public.extraction_field_name
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$ select * from public.audit_logs where entity_id = p_entity_id $$;
grant execute on all functions in schema tests to authenticated;

-- Statement ...70..02 (review_required, matched to MSQ-L001, in force 2024-01-01 to 2028-12-31) has extraction ...71..01
-- with rental_charged (flagged) and tenant_name. The statement prints no number; total_due was not found either.
insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
select '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', v.name::public.extraction_field_name,
       v.raw, v.value::jsonb, v.confidence, v.flagged
from (values
  ('unit_number', 'Shop 12', '"Shop 12"', 0.97, false),
  ('statement_number', '', 'null', 0, true),
  ('statement_date', '31 Oct 2026', '"2026-10-31"', 0.97, false),
  ('period_start', '01 Oct 2026', '"2026-10-01"', 0.97, false),
  ('period_end', '31 Oct 2026', '"2026-10-31"', 0.97, false),
  ('opening_balance', 'R 0,00', '0', 0.97, false),
  ('additional_charges', 'R 960,00', '960', 0.97, false),
  ('payments_received', 'R 0,00', '0', 0.97, false),
  ('outstanding_balance', 'R 12 960,00', '12960', 0.97, false),
  ('total_due', '', 'null', 0, true)
) as v(name, raw, value, confidence, flagged);

-- A statement whose processing failed (review_required with a processing error), and one in another company.
insert into public.statements (id, company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256, source_system, status, processing_error, uploaded_by_user_id)
values
  ('70000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'failed.pdf',
   '20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000021/failed.pdf', 'application/pdf', 100, repeat('d', 64), 'MRI',
   'review_required', 'The document could not be read', '10000000-0000-4000-8000-000000000003'),
  ('70000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'failed-b.pdf',
   '20000000-0000-4000-8000-000000000002/70000000-0000-4000-8000-000000000022/failed-b.pdf', 'application/pdf', 100, repeat('e', 64), 'Sage',
   'review_required', 'The document could not be read', '10000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ read-only members
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$select public.retry_statement_processing('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000021')$$,
  '42501', null, 'a read-only member cannot process a statement again');
reset role;

-- ------------------------------------------------------------------ a property manager
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

-- No direct status writes.
select throws_ok(
  $$update public.statement_extractions set status = 'confirmed' where id = '71000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a signed-in user cannot close an extraction review directly');
select throws_ok(
  $$update public.statement_extractions set review_notes = 'Looks fine' where id = '71000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'nor write its review notes');
select throws_ok(
  $$update public.statements set status = 'processing' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot move a statement back to processing');
select throws_ok(
  $$update public.statements set status = 'uploaded', processing_error = null where id = '70000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'nor reset a failed statement directly');
select throws_ok(
  $$update public.statements set processing_error = 'Made up' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'nor write a processing error');

-- The statement number may be confirmed as not on the statement; any other missing value must be entered.
select throws_ok(
  $$update public.statement_extraction_fields set confirmed_at = now()
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'total_due'$$,
  '23514', null, 'a missing amount still cannot be confirmed');
update public.statement_extraction_fields set confirmed_at = now()
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'statement_number';
select is(
  (select row(value, corrected_value, confirmed_by_user_id)::text from tests.field('statement_number')),
  row('null'::jsonb, null::jsonb, '10000000-0000-4000-8000-000000000003'::uuid)::text,
  'confirming that the number is not on the statement records who, and fills nothing in');
select is(
  (select count(*) from tests.audit('71000000-0000-4000-8000-000000000001')
   where action = 'verify' and actor_user_id = '10000000-0000-4000-8000-000000000003'
     and summary = 'Confirmed that statement_number is not on the statement'
     and changes @> '[{"field":"statement_number","before":null,"after":null},{"field":"statement_number.confirmed","before":false,"after":true}]'),
  1::bigint, 'and is audited like any other confirmation');

-- The period and the lease are checked against the reviewed dates, every reason listed.
update public.statement_extraction_fields set confirmed_at = now()
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
update public.statement_extraction_fields set corrected_value = '12960'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'total_due';
update public.statement_extraction_fields set corrected_value = '"2023-12-31"'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'statement_date';
update public.statement_extraction_fields set corrected_value = '"2026-09-30"'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'period_end';
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  '23514', 'The period end is before the period start; The lease MSQ-L001 was not in force on 31 Dec 2023',
  'verification is refused for a reversed period and a lease not in force on the statement date, listing both');

-- A draft lease was never in force (as the service role, which keeps table-wide rights).
update public.statement_extraction_fields set corrected_value = null
where extraction_id = '71000000-0000-4000-8000-000000000001' and name in ('statement_date', 'period_end');
reset role;
update public.leases set status = 'draft' where id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  '23514', 'The lease MSQ-L001 was not in force on 31 Oct 2026', 'a draft lease is never in force');
reset role;
update public.leases set status = 'active' where id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;

select is(public.verify_statement('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'),
  '70000000-0000-4000-8000-000000000002'::uuid, 'a statement without a number is verified once that is confirmed');
select is(
  (select row(status, statement_number, statement_date, period_start, period_end, closing_balance, total_due)::text
   from tests.statement('70000000-0000-4000-8000-000000000002')),
  row('verified'::public.statement_status, null::text, '2026-10-31'::date, '2026-10-01'::date, '2026-10-31'::date,
      12960::numeric(14,2), 12960::numeric(14,2))::text,
  'the verified statement has no number, and its other values as reviewed');
select is((select status from public.statement_extractions where id = '71000000-0000-4000-8000-000000000001'),
  'corrected'::public.extraction_status, 'the extraction review is closed by verification');

-- ------------------------------------------------------------------ processing again
select throws_ok(
  $$select public.retry_statement_processing('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$,
  'P0001', 'This statement''s processing has not failed, so it is not processed again from the start.',
  'a statement whose processing did not fail is not reset');
select throws_ok(
  $$select public.retry_statement_processing('20000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000022')$$,
  '42501', null, 'a writer of one company cannot reset another company''s statement');
select is(public.retry_statement_processing('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000022'),
  null::uuid, 'another company''s statement is not found');
select is(public.retry_statement_processing('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000021'),
  '70000000-0000-4000-8000-000000000021'::uuid, 'a writer puts a failed statement back to uploaded');
select is(
  (select row(status, processing_error)::text from tests.statement('70000000-0000-4000-8000-000000000021')),
  row('uploaded'::public.statement_status, null::text)::text, 'with the processing error cleared');
select is(
  (select count(*) from tests.audit('70000000-0000-4000-8000-000000000021')
   where actor_user_id = '10000000-0000-4000-8000-000000000003'
     and changes @> '[{"field":"status","before":"review_required","after":"uploaded"}]'),
  1::bigint, 'the reset is audited');
select throws_ok(
  $$select public.retry_statement_processing('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000021')$$,
  'P0001', null, 'an uploaded statement is not reset again');
reset role;

select * from finish();
rollback;
