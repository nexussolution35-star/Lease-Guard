-- Portfolio import column mappings (ticket I-02): applying a mapping to a batch, saving it for the same headings,
-- clearing it when another sheet is read, writer-only changes, company scoping and audit.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(15);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.batch(p_id uuid) returns public.portfolio_imports
language sql security definer set search_path = '' as $$
  select * from public.portfolio_imports where id = p_id
$$;
create function tests.saved(p_company uuid) returns setof public.portfolio_import_mappings
language sql security definer set search_path = '' as $$
  select * from public.portfolio_import_mappings where company_id = p_company
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '62000000-0000-4000-8000-000000000001'::uuid as csv_batch,
  '62000000-0000-4000-8000-000000000002'::uuid as xlsx_batch,
  repeat('c', 64) as signature;
grant select on tests.ids to authenticated, service_role;

-- ------------------------------------------------------------------ a property manager applies a mapping
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select public.create_portfolio_import(
  (select csv_batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'rent-roll.csv',
  (select nexus from tests.ids)::text || '/' || (select csv_batch from tests.ids)::text || '/rent-roll.csv',
  'csv', 120, repeat('a', 64), null, null, ',', array['Prop Code', 'Unit No'], '[{"rowNumber": 2, "cells": ["MSQ", "Shop 1"]}]'
);

select lives_ok(
  $$select public.save_portfolio_import_mapping((select nexus from tests.ids), (select csv_batch from tests.ids),
    (select signature from tests.ids), '{"propertyCode": "Prop Code", "unitNumber": "Unit No"}')$$,
  'a property manager applies a mapping'
);
select is((tests.batch((select csv_batch from tests.ids))).column_mapping, '{"propertyCode": "Prop Code", "unitNumber": "Unit No"}'::jsonb,
  'the mapping is kept on the batch');
select is((select count(*) from tests.saved((select nexus from tests.ids))), 1::bigint, 'and saved for the headings');
select is((select (saved_by_user_id, scope, columns)::text from tests.saved((select nexus from tests.ids))),
  '(10000000-0000-4000-8000-000000000003,properties,"{""Prop Code"",""Unit No""}")', 'with who saved it, the scope and the headings');
select is((select summary from tests.audit((select csv_batch from tests.ids)) where action = 'update'),
  'Column mapping applied to portfolio file rent-roll.csv', 'applying a mapping is audited on the batch');

select lives_ok(
  $$select public.save_portfolio_import_mapping((select nexus from tests.ids), (select csv_batch from tests.ids),
    (select signature from tests.ids), '{"unitNumber": "Unit No"}')$$,
  'a mapping can be applied again'
);
select is((select column_mapping from tests.saved((select nexus from tests.ids))), '{"unitNumber": "Unit No"}'::jsonb,
  'the saved mapping for the same headings is replaced, not duplicated');
select throws_ok(
  $$select public.save_portfolio_import_mapping((select nexus from tests.ids), (select csv_batch from tests.ids), 'nothex', '{}')$$,
  '23514', null, 'the headings are identified by a SHA-256'
);
select throws_ok(
  $$update public.portfolio_imports set column_mapping = '[]' where id = (select csv_batch from tests.ids)$$,
  '23514', null, 'a mapping is an object'
);

-- Reading another sheet clears the mapping: its columns differ.
select public.create_portfolio_import(
  (select xlsx_batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'portfolio.xlsx',
  (select nexus from tests.ids)::text || '/' || (select xlsx_batch from tests.ids)::text || '/portfolio.xlsx',
  'xlsx', 2048, repeat('b', 64), 'Units', array['Notes', 'Units'], null, array['Unit No'], '[{"rowNumber": 2, "cells": ["Shop 1"]}]'
);
select public.save_portfolio_import_mapping((select nexus from tests.ids), (select xlsx_batch from tests.ids), repeat('d', 64), '{"unitNumber": "Unit No"}');
select public.replace_portfolio_import_sheet((select nexus from tests.ids), (select xlsx_batch from tests.ids), 'Notes',
  array['Note'], '[{"rowNumber": 2, "cells": ["a"]}]');
select is((tests.batch((select xlsx_batch from tests.ids))).column_mapping, null, 'reading another sheet clears the mapping');

-- ------------------------------------------------------------------ other roles and companies
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.portfolio_import_mappings), 2::bigint, 'read-only members read the saved mappings');
select throws_ok(
  $$select public.save_portfolio_import_mapping((select nexus from tests.ids), (select csv_batch from tests.ids), (select signature from tests.ids), '{}')$$,
  'P0002', null, 'read-only members cannot apply a mapping'
);
select throws_ok(
  $$insert into public.portfolio_import_mappings (company_id, scope, header_signature, columns, column_mapping)
    values ((select nexus from tests.ids), 'units', repeat('e', 64), '{A}', '{}')$$,
  '42501', null, 'nor save one'
);
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is((select count(*) from public.portfolio_import_mappings where company_id = (select nexus from tests.ids)), 0::bigint,
  'another company sees no saved mappings');
select throws_ok(
  $$insert into public.portfolio_import_mappings (company_id, scope, header_signature, columns, column_mapping, saved_by_user_id)
    values ((select nexus from tests.ids), 'units', repeat('e', 64), '{A}', '{}', (select naledi from tests.ids))$$,
  '42501', null, 'who saved a mapping cannot be set by the client'
);

select * from finish();
rollback;
