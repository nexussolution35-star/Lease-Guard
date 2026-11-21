-- Approving a portfolio import (ticket I-04): the new properties and units land through the property and unit tables'
-- own grants, guards and audit triggers in one transaction (all or none), each created record is listed against the
-- batch and audited as created by import with the batch reference, the approval is signed off on the batch, a second
-- copy of a record is refused, nobody stamps an approval by hand, only writers apply, and no tenant message appears.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(19);

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
create function tests.records(p_import uuid) returns setof public.portfolio_import_records
language sql security definer set search_path = '' as $$
  select * from public.portfolio_import_records where import_id = p_import order by row_number, record_type
$$;
create function tests.property_by_code(p_company uuid, p_code text) returns public.properties
language sql security definer set search_path = '' as $$
  select * from public.properties where company_id = p_company and code = p_code
$$;
create function tests.communications(p_company uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.communications where company_id = p_company
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '30000000-0000-4000-8000-000000000001'::uuid as msq,
  '64000000-0000-4000-8000-000000000001'::uuid as batch,
  (select count(*) from public.communications where company_id = '20000000-0000-4000-8000-000000000001') as messages;
grant select on tests.ids to authenticated, service_role;

create table tests.plan as select
  jsonb_build_array(
    jsonb_build_object('row_number', 2, 'code', 'IMP', 'name', 'Imported Park', 'type', 'office', 'status', 'active',
      'address_line1', '5 Import Way', 'address_line2', null, 'suburb', 'Rosebank', 'city', 'Johannesburg', 'province', 'Gauteng',
      'postal_code', '2196', 'description', '', 'gross_lettable_area_sqm', 4000,
      'manager_user_id', '10000000-0000-4000-8000-000000000003', 'owner_user_id', null, 'accounting_system', 'MRI')
  ) as properties,
  jsonb_build_array(
    jsonb_build_object('row_number', 2, 'property_code', 'IMP', 'unit_number', 'A1', 'type', 'line_shop', 'floor_area_sqm', 120,
      'floor', null, 'occupancy_status', 'vacant', 'description', null),
    jsonb_build_object('row_number', 3, 'property_id', '30000000-0000-4000-8000-000000000001', 'unit_number', 'S99', 'type', 'line_shop',
      'floor_area_sqm', 60, 'floor', null, 'occupancy_status', 'vacant', 'description', null)
  ) as units;
grant select on tests.plan to authenticated, service_role;

-- ------------------------------------------------------------------ a property manager approves the import
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select public.create_portfolio_import(
  (select batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'portfolio.csv',
  (select nexus from tests.ids)::text || '/' || (select batch from tests.ids)::text || '/portfolio.csv',
  'csv', 120, repeat('a', 64), null, null, ',', array['Code', 'Unit'],
  '[{"rowNumber": 2, "cells": ["IMP", "A1"]}, {"rowNumber": 3, "cells": ["MSQ", "S99"]}]'
);

select throws_ok(
  $$update public.portfolio_imports set approved_at = now() where id = (select batch from tests.ids)$$,
  '42501', 'An import is approved only by applying it', 'nobody stamps an approval by hand'
);

select lives_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids),
    (select properties from tests.plan), (select units from tests.plan))$$,
  'a property manager approves the import'
);

select isnt((tests.property_by_code((select nexus from tests.ids), 'IMP')).id, null, 'the new property is created');
select is((tests.property_by_code((select nexus from tests.ids), 'IMP')).manager_user_id, (select naledi from tests.ids), 'with its manager');
select is(
  (select array_agg(r.record_type || ':' || r.row_number order by r.row_number, r.record_type) from tests.records((select batch from tests.ids)) r),
  array['property:2', 'unit:2', 'unit:3'], 'every created record is listed against the batch with its row'
);
select is(
  (select count(*)::integer from tests.records((select batch from tests.ids)) r where r.unit_id is not null and r.property_id = (select msq from tests.ids)),
  1, 'a unit added to an existing property is recorded with that property'
);
select is((tests.batch((select batch from tests.ids))).approved_by_user_id, (select naledi from tests.ids), 'the approval is signed off with who approved');
select isnt((tests.batch((select batch from tests.ids))).approved_at, null, 'and when');

select is(
  (select summary from tests.audit((tests.property_by_code((select nexus from tests.ids), 'IMP')).id) where action = 'create'),
  'Property Imported Park (IMP) created by import of portfolio.csv, row 2', 'the property is audited as created by import'
);
select ok(
  (select changes @> jsonb_build_array(jsonb_build_object('field', 'portfolioImportId', 'before', null, 'after', (select batch from tests.ids)))
   from tests.audit((tests.property_by_code((select nexus from tests.ids), 'IMP')).id) where action = 'create'),
  'with the batch reference'
);
select is(
  (select summary from tests.audit((select unit_id from tests.records((select batch from tests.ids)) where row_number = 3))),
  'Unit S99 created in Maponya Square by import of portfolio.csv, row 3', 'each unit is audited as created by import'
);
select is(
  (select (actor_user_id, summary)::text from tests.audit((select batch from tests.ids)) where action = 'approve'),
  '(10000000-0000-4000-8000-000000000003,"Portfolio file portfolio.csv approved: 1 property and 2 units created")',
  'the approval is audited on the batch'
);
select is(tests.communications((select nexus from tests.ids)), (select messages from tests.ids), 'no tenant message is created by importing');

-- ------------------------------------------------------------------ approving again never creates a second copy
select throws_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids),
    (select properties from tests.plan), '[]'::jsonb)$$,
  '23505', null, 'a property already created is refused, so approving twice adds nothing'
);
select throws_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids), '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('row_number', 4, 'property_id', '30000000-0000-4000-8000-000000000001', 'unit_number', 'S98', 'type', 'line_shop', 'floor_area_sqm', 50),
      (select units -> 1 from tests.plan)))$$,
  '23505', null, 'one unit already there refuses the whole approval'
);
select is(
  (select count(*)::integer from public.units where property_id = (select msq from tests.ids) and unit_number = 'S98'),
  0, 'and nothing of it lands'
);

-- Outside the function, the import setting is cleared: a later insert in the transaction is not "created by import".
select is(current_setting('leaseguard.portfolio_import_id', true), '', 'the import setting is cleared after applying');

-- ------------------------------------------------------------------ members who only read cannot apply
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('row_number', 5, 'property_id', '30000000-0000-4000-8000-000000000001', 'unit_number', 'R1', 'type', 'line_shop', 'floor_area_sqm', 50)))$$,
  'P0002', null, 'a read-only member does not find the batch to apply'
);
select is((select count(*)::integer from public.portfolio_import_records), 3, 'and members read the created records');

select * from finish();
rollback;
