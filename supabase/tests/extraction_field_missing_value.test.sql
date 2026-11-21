-- A field the document did not show is stored as JSON null even when the insert names `value` and sends SQL NULL
-- (migration 20261121183305, found by the statements acceptance test, ticket S-09): the statement-processing worker's
-- bulk upsert of an extraction's fields can then store a missing value beside the found ones.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(4);

-- Extraction 71000000-...-0001 (pending review) of statement 70000000-...-0002 already has rental_charged and tenant_name.
select lives_ok(
  $$insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
    values ('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'additional_charges', '', null, 0, true),
           ('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'total_due', 'R 12 000,00', '12000', 0.95, false)$$,
  'one insert stores a missing value (SQL NULL) beside a found one');
select is(
  (select value from public.statement_extraction_fields
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'additional_charges'),
  'null'::jsonb, 'the missing value is stored as JSON null');
select is(
  (select value from public.statement_extraction_fields
    where extraction_id = '71000000-0000-4000-8000-000000000001' and name = 'total_due'),
  '12000'::jsonb, 'a found value is stored as sent');
select throws_ok(
  $$insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
    values ('20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'payments_received', '', null, 0, false)$$,
  '23514', null, 'a missing value must still be flagged');

select * from finish();
rollback;
