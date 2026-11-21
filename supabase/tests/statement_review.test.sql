-- Statement review and correction (PRD module 6, ticket S-04): fields are corrected or confirmed only while the
-- statement is under review, by whom and when is stamped, every correction and confirmation is audited with before
-- and after, a missing value cannot be confirmed, a statement's match is audited and fixed once it is closed, and a
-- signed-in caller writes only the review columns.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(24);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, created_at, id
$$;
create function tests.field(p_name text) returns public.statement_extraction_fields
language sql security definer set search_path = '' as $$
  select * from public.statement_extraction_fields
  where extraction_id = '71000000-0000-4000-8000-000000000001' and name = p_name::public.extraction_field_name
$$;
grant execute on all functions in schema tests to authenticated;

-- The pending extraction ...71..01 of statement ...70..02 (review_required) gets a field the extractor did not find.
insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, confidence, flagged)
values ('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'total_due', '', 0, true);

-- ------------------------------------------------------------------ a property manager reviews the fields
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

update public.statement_extraction_fields set confirmed_at = '2000-01-01'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
select is((tests.field('rental_charged')).confirmed_by_user_id, '10000000-0000-4000-8000-000000000003'::uuid,
  'a confirmation records the signed-in user');
select ok((tests.field('rental_charged')).confirmed_at > now() - interval '1 minute', 'and the time, not the one the client sent');
select is(
  (select count(*) from tests.audit('71000000-0000-4000-8000-000000000001')
   where action = 'verify' and summary = 'Confirmed extracted field rental_charged'
     and changes @> '[{"field":"rental_charged","before":12000,"after":12000},{"field":"rental_charged.confirmed","before":false,"after":true}]'),
  1::bigint, 'a confirmation is audited with before and after');
select is((select actor_user_id from tests.audit('71000000-0000-4000-8000-000000000001') where action = 'verify'),
  '10000000-0000-4000-8000-000000000003'::uuid, 'by the signed-in user');

update public.statement_extraction_fields set corrected_value = '12500'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
select is(
  (select row(corrected_by_user_id, corrected_at is not null, confirmed_by_user_id, confirmed_at)::text from tests.field('rental_charged')),
  row('10000000-0000-4000-8000-000000000003'::uuid, true, null::uuid, null::timestamptz)::text,
  'a correction records who and when and replaces the confirmation');
select is(
  (select count(*) from tests.audit('71000000-0000-4000-8000-000000000001')
   where summary = 'Corrected extracted field rental_charged'
     and changes @> '[{"field":"rental_charged","before":12000,"after":12500},{"field":"rental_charged.confirmed","before":true,"after":false}]'),
  1::bigint, 'a correction is audited with before and after');

update public.statement_extraction_fields set corrected_value = null, confirmed_at = now()
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
select is(
  (select row(corrected_value, corrected_by_user_id, corrected_at, confirmed_by_user_id)::text from tests.field('rental_charged')),
  row(null::jsonb, null::uuid, null::timestamptz, '10000000-0000-4000-8000-000000000003'::uuid)::text,
  'confirming the extracted value drops the correction');
select is(
  (select count(*) from tests.audit('71000000-0000-4000-8000-000000000001')
   where summary = 'Confirmed extracted field rental_charged' and changes @> '[{"field":"rental_charged","before":12500,"after":12000}]'),
  1::bigint, 'confirming after a correction is audited from the correction back to the extracted value');

select throws_ok(
  $$update public.statement_extraction_fields set confirmed_at = now()
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'total_due'$$,
  '23514', null, 'a field without a value cannot be confirmed');
update public.statement_extraction_fields set corrected_value = '"Dlamini Cellular (Pty) Ltd"', confirmed_at = now()
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'tenant_name';
select is((select row(corrected_value, confirmed_at)::text from tests.field('tenant_name')),
  row('"Dlamini Cellular (Pty) Ltd"'::jsonb, null::timestamptz)::text, 'a field is corrected or confirmed, not both');
select throws_ok(
  $$update public.statement_extraction_fields set value = '99999'
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged'$$,
  '42501', null, 'a signed-in user cannot rewrite the extracted value');
select throws_ok(
  $$update public.statement_extraction_fields set corrected_by_user_id = '10000000-0000-4000-8000-000000000001'
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged'$$,
  '42501', null, 'a signed-in user cannot name another corrector');
select throws_ok(
  $$delete from public.statement_extraction_fields where extraction_id = '71000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a signed-in user cannot delete extracted fields');
select throws_ok(
  $$insert into public.statement_line_items (company_id, statement_id, line_number, date, description, category, kind, amount)
    values ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 99, '2026-10-01', 'x', 'rental', 'charge', 1)$$,
  '42501', null, 'a signed-in user cannot add line items');

-- ------------------------------------------------------------------ the statement's match
update public.statements
set tenant_id = '50000000-0000-4000-8000-000000000002', unit_id = '40000000-0000-4000-8000-000000000002',
    lease_id = '60000000-0000-4000-8000-000000000002'
where id = '70000000-0000-4000-8000-000000000002';
select is(
  (select count(*) from tests.audit('70000000-0000-4000-8000-000000000002')
   where summary = 'Statement MSQ-2026-10.pdf: tenant, unit and lease set'
     and changes @> '[{"field":"tenantId","before":"50000000-0000-4000-8000-000000000001","after":"50000000-0000-4000-8000-000000000002"},{"field":"leaseId","after":"60000000-0000-4000-8000-000000000002"}]'),
  1::bigint, 'setting the tenant, unit and lease is audited with before and after');
select throws_ok(
  $$update public.statements set lease_id = '60000000-0000-4000-8000-000000000001' where id = '70000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a lease of another tenant and unit is refused');
select throws_ok(
  $$update public.statements set unit_id = '40000000-0000-4000-8000-000000000004', lease_id = null where id = '70000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a unit of another property is refused');
select throws_ok(
  $$update public.statements set tenant_id = '50000000-0000-4000-8000-000000000002' where id = '70000000-0000-4000-8000-000000000001'$$,
  'P0001', 'This statement is verified, so its tenant, unit and lease cannot change.', 'a verified statement keeps its match');
select throws_ok(
  $$update public.statements set file_name = 'renamed.pdf' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot change a statement''s file');
select throws_ok(
  $$update public.statements set verified_by_user_id = '10000000-0000-4000-8000-000000000003' where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot name a verifier');
select throws_ok(
  $$delete from public.statements where id = '70000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a signed-in user cannot delete a statement');

-- ------------------------------------------------------------------ a closed review cannot change
-- The extraction review is closed by the outcome functions only; close it as the service role here.
reset role;
update public.statement_extractions set status = 'corrected' where id = '71000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$update public.statement_extraction_fields set corrected_value = '13000'
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged'$$,
  'P0001', 'This statement is no longer under review, so its extracted values cannot change.',
  'fields cannot change once the extraction is reviewed');
reset role;

-- ------------------------------------------------------------------ read-only members cannot review
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
update public.statement_extraction_fields set corrected_value = '1'
where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'rental_charged';
update public.statements set tenant_id = '50000000-0000-4000-8000-000000000001', unit_id = '40000000-0000-4000-8000-000000000001',
  lease_id = '60000000-0000-4000-8000-000000000001'
where id = '70000000-0000-4000-8000-000000000002';
reset role;
select is((tests.field('rental_charged')).corrected_value, null::jsonb, 'a read-only member corrects nothing');
select is((select tenant_id from public.statements where id = '70000000-0000-4000-8000-000000000002'),
  '50000000-0000-4000-8000-000000000002'::uuid, 'a read-only member changes no match');

select * from finish();
rollback;
