-- Statement facts from the document (ticket S-01): the statement number and opening balance are extraction
-- fields; a statement's date and period may be unknown until it is verified, but a verified statement has
-- them; a period is known as a whole; changes to the number, date and period are audited.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(11);

-- Nexus (NS) company, property MSQ, statement uploader Naledi, verified fixture statement ...0001.
create schema tests;
create function tests.insert_statement(p_id uuid, p_date date, p_start date, p_end date, p_status public.statement_status default 'uploaded')
returns void language sql set search_path = '' as $$
  insert into public.statements (id, company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, statement_date, period_start, period_end, status, uploaded_by_user_id)
  values (p_id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || p_id || '/x.pdf', 'application/pdf', 1, md5(p_id::text) || md5(p_id::text),
      'MRI', p_date, p_start, p_end, p_status, '10000000-0000-4000-8000-000000000003')
$$;

select ok(
  (select array['statement_number', 'opening_balance']::text[] <@ enum_range(null::public.extraction_field_name)::text[]),
  'statement_number and opening_balance are extraction fields');
select is(
  (select enum_range(null::public.extraction_field_name)::text[]),
  array['tenant_name', 'unit_number', 'statement_number', 'statement_date', 'period_start', 'period_end', 'opening_balance',
        'rental_charged', 'additional_charges', 'payments_received', 'outstanding_balance', 'total_due'],
  'extraction fields keep the domain order');

select lives_ok(
  $$select tests.insert_statement('71000000-0000-4000-8000-000000000001', null, null, null)$$,
  'a statement can be uploaded without a date or period');
select lives_ok(
  $$select tests.insert_statement('71000000-0000-4000-8000-000000000002', '2026-11-30', '2026-11-01', '2026-11-30')$$,
  'a statement can be uploaded with a typed date and period');
select throws_ok(
  $$select tests.insert_statement('71000000-0000-4000-8000-000000000003', null, '2026-11-01', null)$$,
  '23514', null, 'a period is known as a whole or not at all');

-- A verified statement still needs its date and period (the figures and verifier are set too, so only the
-- date check can fail).
select throws_ok(
  $$update public.statements set statement_date = null
     where id = '70000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a verified statement cannot lose its statement date');
select throws_ok(
  $$update public.statements set period_start = null, period_end = null
     where id = '70000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a verified statement cannot lose its period');

-- The number and opening balance are stored per extraction with their confidence and flag.
insert into public.statement_extractions (id, company_id, statement_id, engine, overall_confidence, match_confidence)
values ('72000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
        'leaseguard-pdf 0.1.0', 0.8, 0);
select lives_ok(
  $$insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
    values ('20000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'statement_number',
            'Statement No: ST-1042', '"ST-1042"', 0.95, false),
           ('20000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'opening_balance',
            'Balance Brought Forward R 70 000,00', '70000', 0.85, true)$$,
  'the statement number and opening balance are stored as extraction fields');
select throws_ok(
  $$insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, confidence, flagged)
    values ('20000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'period_start', '', 0, false)$$,
  '23514', null, 'a field the document did not show is flagged, never stored as found');

-- Changes to the number, date and period are audited with before and after.
update public.statements set statement_number = 'ST-1042', statement_date = '2026-11-30',
    period_start = '2026-11-01', period_end = '2026-11-30'
  where id = '71000000-0000-4000-8000-000000000001';
select is(
  (select array_agg(c->>'field' order by c->>'field') from public.audit_logs a, jsonb_array_elements(a.changes) c
    where a.entity_id = '71000000-0000-4000-8000-000000000001' and a.action = 'update'),
  array['periodEnd', 'periodStart', 'statementDate', 'statementNumber'],
  'the statement number, date and period changes are audited');
select is(
  (select c from public.audit_logs a, jsonb_array_elements(a.changes) c
    where a.entity_id = '71000000-0000-4000-8000-000000000001' and c->>'field' = 'statementDate'),
  '{"field": "statementDate", "before": null, "after": "2026-11-30"}'::jsonb,
  'an audited date records its value before and after');

select * from finish();
rollback;
