-- Resolving portfolio import rows (ticket I-03): corrections, skips and links kept on the batch row (never on the
-- live property or unit), who changed it and when stamped, links kept coherent, writer-only changes, company scoping,
-- and one audit row per change with the previous and new values.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(20);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id and action = 'update' order by occurred_at, id
$$;
create function tests.row(p_import uuid, p_row integer) returns public.portfolio_import_rows
language sql security definer set search_path = '' as $$
  select * from public.portfolio_import_rows where import_id = p_import and row_number = p_row
$$;
create function tests.property(p_id uuid) returns public.properties
language sql security definer set search_path = '' as $$
  select * from public.properties where id = p_id
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '30000000-0000-4000-8000-000000000001'::uuid as msq,
  '30000000-0000-4000-8000-000000000002'::uuid as kgp,
  '40000000-0000-4000-8000-000000000001'::uuid as s01,
  '40000000-0000-4000-8000-000000000004'::uuid as k01,
  '63000000-0000-4000-8000-000000000001'::uuid as batch,
  '63000000-0000-4000-8000-000000000002'::uuid as units_batch;
grant select on tests.ids to authenticated, service_role;

-- ------------------------------------------------------------------ a property manager resolves rows
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select public.create_portfolio_import(
  (select batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'rent-roll.csv',
  (select nexus from tests.ids)::text || '/' || (select batch from tests.ids)::text || '/rent-roll.csv',
  'csv', 120, repeat('a', 64), null, null, ',', array['Code', 'Province', 'Unit'],
  '[{"rowNumber": 2, "cells": ["MSQ", "Gautng", "S01"]}, {"rowNumber": 3, "cells": ["NEW", "Gauteng", "A1"]}]'
);
select public.save_portfolio_import_mapping((select nexus from tests.ids), (select batch from tests.ids), repeat('c', 64),
  '{"propertyCode": "Code", "province": "Province", "unitNumber": "Unit"}');

select lives_ok(
  $$update public.portfolio_import_rows set corrections = '{"province": "Gauteng"}'
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  'a property manager corrects a value'
);
select is((tests.row((select batch from tests.ids), 2)).corrections, '{"province": "Gauteng"}'::jsonb, 'the correction is kept on the batch row');
select is((tests.row((select batch from tests.ids), 2)).cells, '["MSQ", "Gautng", "S01"]'::jsonb, 'the file''s cells are unchanged');
select is((tests.row((select batch from tests.ids), 2)).changed_by_user_id, (select naledi from tests.ids), 'who changed the row is stamped');
select isnt((tests.row((select batch from tests.ids), 2)).changed_at, null, 'and when');
select is((tests.property((select msq from tests.ids))).province::text, 'Gauteng', 'the live property is not touched');
select is(
  (select (summary, changes)::text from tests.audit((select batch from tests.ids)) where summary like 'Row 2%' and changes -> 0 ->> 'after' = 'Gauteng'),
  '("Row 2 of portfolio file rent-roll.csv: province corrected","[{""after"": ""Gauteng"", ""field"": ""row 2 province"", ""before"": ""Gautng""}]")',
  'the correction is audited with the file''s value as the previous value'
);

update public.portfolio_import_rows set corrections = '{"province": "Western Cape"}'
  where import_id = (select batch from tests.ids) and row_number = 2;
select is(
  (select changes -> 0 ->> 'before' from tests.audit((select batch from tests.ids)) where changes -> 0 ->> 'after' = 'Western Cape'),
  'Gauteng', 'a second correction records the earlier correction as the previous value'
);

select lives_ok(
  $$update public.portfolio_import_rows set skipped = true where import_id = (select batch from tests.ids) and row_number = 3$$,
  'a row is skipped'
);
select is(
  (select summary from tests.audit((select batch from tests.ids)) where summary like 'Row 3%'),
  'Row 3 of portfolio file rent-roll.csv: skipped', 'the skip is audited'
);

select lives_ok(
  $$update public.portfolio_import_rows set linked_property_id = (select msq from tests.ids), linked_unit_id = (select s01 from tests.ids)
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  'a row is linked to an existing property and unit'
);
select is(
  (select summary from tests.audit((select batch from tests.ids)) where summary like 'Row 2%linked%'),
  'Row 2 of portfolio file rent-roll.csv: linked to Maponya Square, linked to unit S01', 'the link is audited'
);
select throws_ok(
  $$update public.portfolio_import_rows set linked_property_id = null where import_id = (select batch from tests.ids) and row_number = 2$$,
  'P0001', 'The unit linked to the row must be one of the property linked to it', 'a linked unit must be of the linked property'
);
select throws_ok(
  $$update public.portfolio_import_rows set linked_property_id = (select kgp from tests.ids), linked_unit_id = null
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  '23503', null, 'another company''s property cannot be linked'
);
select throws_ok(
  $$update public.portfolio_import_rows set cells = '[]' where import_id = (select batch from tests.ids) and row_number = 2$$,
  '42501', null, 'the file''s cells cannot be changed'
);
select throws_ok(
  $$update public.portfolio_import_rows set changed_by_user_id = null where import_id = (select batch from tests.ids) and row_number = 2$$,
  '42501', null, 'nor who changed the row'
);

-- A units batch is for its own property: it links units of that property only.
select public.create_portfolio_import(
  (select units_batch from tests.ids), (select nexus from tests.ids), 'units', (select msq from tests.ids), 'units.csv',
  (select nexus from tests.ids)::text || '/' || (select units_batch from tests.ids)::text || '/units.csv',
  'csv', 40, repeat('b', 64), null, null, ',', array['Unit'], '[{"rowNumber": 2, "cells": ["S1"]}]'
);
select throws_ok(
  $$update public.portfolio_import_rows set linked_property_id = (select msq from tests.ids) where import_id = (select units_batch from tests.ids)$$,
  'P0001', 'This import adds units to one property: link the row to one of its units', 'a units batch links no property'
);

-- ------------------------------------------------------------------ other roles and companies
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
update public.portfolio_import_rows set skipped = false where import_id = (select batch from tests.ids) and row_number = 3;
select is((tests.row((select batch from tests.ids), 3)).skipped, true, 'read-only members cannot change a row');
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
update public.portfolio_import_rows set skipped = false where import_id = (select batch from tests.ids) and row_number = 3;
select is((tests.row((select batch from tests.ids), 3)).skipped, true, 'nor can property owners');
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
update public.portfolio_import_rows set skipped = false where import_id = (select batch from tests.ids) and row_number = 3;
select is((tests.row((select batch from tests.ids), 3)).skipped, true, 'nor another company');

select * from finish();
rollback;
