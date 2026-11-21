-- Portfolio import batches read from a Google Sheets link (ticket I-06): the sheet and tab are stored with a CSV batch.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(7);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.batch(p_id uuid) returns public.portfolio_imports
language sql security definer set search_path = '' as $$
  select * from public.portfolio_imports where id = p_id
$$;

-- A Google Sheet batch of Nexus with the fixed parts filled in.
create function tests.create_sheet(p_id uuid, p_format text, p_spreadsheet text, p_gid text)
returns public.portfolio_imports language sql set search_path = '' as $$
  select public.create_portfolio_import(
    p_id, '20000000-0000-4000-8000-000000000001', 'properties', null, 'Rent roll - Units.csv',
    '20000000-0000-4000-8000-000000000001/' || p_id::text || '/Rent-roll-Units.csv',
    p_format, 120, repeat('a', 64),
    case when p_format = 'xlsx' then 'Sheet1' end, case when p_format = 'xlsx' then array['Sheet1'] else '{}' end,
    case when p_format = 'csv' then ',' end,
    array['Property code'], '[{"rowNumber": 2, "cells": ["MSQ"]}]', p_spreadsheet, p_gid
  )
$$;
grant execute on function tests.create_sheet(uuid, text, text, text) to authenticated;

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$select tests.create_sheet('60000000-0000-4000-8000-0000000000f1'::uuid, 'csv', '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', '1386834576')$$,
  'a property manager records a batch read from a Google Sheet tab'
);
select is(
  (select (b.google_spreadsheet_id, b.google_sheet_gid, b.file_format)::text from tests.batch('60000000-0000-4000-8000-0000000000f1'::uuid) b),
  '(1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms,1386834576,csv)',
  'with the spreadsheet and tab it was read from'
);
select lives_ok(
  $$select tests.create_sheet(gen_random_uuid(), 'csv', '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', null)$$,
  'the first tab is recorded without a tab id'
);
select throws_ok(
  $$select tests.create_sheet(gen_random_uuid(), 'xlsx', '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', null)$$,
  '23514', null, 'a Google Sheet batch is always a CSV snapshot'
);
select throws_ok(
  $$select tests.create_sheet(gen_random_uuid(), 'csv', null, '7')$$,
  '23514', null, 'a tab needs its spreadsheet'
);
select throws_ok(
  $$select tests.create_sheet(gen_random_uuid(), 'csv', 'https://evil.example/x', null)$$,
  '23514', null, 'only a spreadsheet id is stored, never a URL'
);

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select tests.create_sheet(gen_random_uuid(), 'csv', '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', null)$$,
  '42501', null, 'read-only members cannot create one'
);

select * from finish();
rollback;
