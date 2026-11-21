-- Tenants from the register (ticket I-05): approving a portfolio import creates its new tenants in the same transaction
-- as its properties and units, through the tenants table's grants, RLS and audit (created by import, with the batch
-- reference), each listed against the batch with its unit; a new tenant's WhatsApp number starts unvalidated and no
-- message appears; the account reference is unique per company; the manager's decision on suggested tenants is kept on
-- the batch row, stamped and audited; only writers apply.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(17);

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
create function tests.records(p_import uuid) returns setof public.portfolio_import_records
language sql security definer set search_path = '' as $$
  select * from public.portfolio_import_records where import_id = p_import order by row_number, record_type
$$;
create function tests.tenant(p_company uuid, p_trading_name text) returns public.tenants
language sql security definer set search_path = '' as $$
  select * from public.tenants where company_id = p_company and trading_name = p_trading_name
$$;
create function tests.row_of(p_import uuid, p_row integer) returns public.portfolio_import_rows
language sql security definer set search_path = '' as $$
  select * from public.portfolio_import_rows where import_id = p_import and row_number = p_row
$$;
create function tests.communications(p_company uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.communications where company_id = p_company
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '30000000-0000-4000-8000-000000000001'::uuid as msq,
  '40000000-0000-4000-8000-000000000001'::uuid as s01,
  '50000000-0000-4000-8000-000000000001'::uuid as dlamini,
  '65000000-0000-4000-8000-000000000001'::uuid as batch,
  (select count(*) from public.communications where company_id = '20000000-0000-4000-8000-000000000001') as messages;
grant select on tests.ids to authenticated, service_role;

-- A tenant of an existing unit, and one of a unit the same call creates.
create table tests.plan as select
  jsonb_build_array(
    jsonb_build_object('row_number', 3, 'property_id', '30000000-0000-4000-8000-000000000001', 'unit_number', 'S77', 'type', 'line_shop',
      'floor_area_sqm', 60, 'floor', null, 'occupancy_status', 'occupied', 'description', null)
  ) as units,
  jsonb_build_array(
    jsonb_build_object('row_number', 2, 'unit_id', '40000000-0000-4000-8000-000000000001', 'property_id', null, 'property_code', null,
      'unit_number', null, 'company_id', '20000000-0000-4000-8000-000000000001', 'legal_name', 'Bean There Coffee (Pty) Ltd',
      'trading_name', 'Bean There', 'business_type', 'pty_ltd', 'registration_number', '2015/123456/07', 'account_reference', 'MSQ-T012',
      'vat_number', null, 'contact_full_name', 'Thandi Mokoena', 'contact_role', '', 'contact_phone', '+27821234567',
      'contact_email', null, 'whatsapp_number', '+27821234567', 'email', null, 'status', 'prospective', 'industry', '', 'notes', null),
    jsonb_build_object('row_number', 3, 'unit_id', null, 'property_id', '30000000-0000-4000-8000-000000000001', 'property_code', null,
      'unit_number', 'S77', 'company_id', '20000000-0000-4000-8000-000000000001', 'legal_name', 'Kwik Print CC',
      'trading_name', 'Kwik Print', 'business_type', 'close_corporation', 'registration_number', null, 'account_reference', null,
      'vat_number', null, 'contact_full_name', 'Sipho', 'contact_role', '', 'contact_phone', '+27831112222',
      'contact_email', 'sipho@kwik.co.za', 'whatsapp_number', '+27831112222', 'email', 'sipho@kwik.co.za', 'status', 'prospective',
      'industry', '', 'notes', null)
  ) as tenants;
grant select on tests.plan to authenticated, service_role;

-- ------------------------------------------------------------------ a property manager approves tenants with the batch
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select public.create_portfolio_import(
  (select batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'register.csv',
  (select nexus from tests.ids)::text || '/' || (select batch from tests.ids)::text || '/register.csv',
  'csv', 120, repeat('b', 64), null, null, ',', array['Code', 'Unit', 'Tenant'],
  '[{"rowNumber": 2, "cells": ["MSQ", "S01", "Bean There"]}, {"rowNumber": 3, "cells": ["MSQ", "S77", "Kwik Print"]}]'
);

-- The manager's decision on a suggested tenant is kept on the batch row, stamped and audited.
select lives_ok(
  $$update public.portfolio_import_rows set linked_tenant_id = (select dlamini from tests.ids)
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  'a writer confirms a suggested tenant on the batch row'
);
select is((tests.row_of((select batch from tests.ids), 2)).changed_by_user_id, (select naledi from tests.ids), 'the decision is signed off with who made it');
select is(
  (select summary from tests.audit((select batch from tests.ids)) where action = 'update' order by occurred_at desc limit 1),
  'Row 2 of portfolio file register.csv: tenant confirmed as Dlamini Cellular', 'and audited on the batch'
);
select throws_ok(
  $$update public.portfolio_import_rows set tenant_suggestions_rejected = true
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  '23514', null, 'a row cannot both confirm a tenant and reject the suggestions'
);
select lives_ok(
  $$update public.portfolio_import_rows set linked_tenant_id = null, tenant_suggestions_rejected = true
    where import_id = (select batch from tests.ids) and row_number = 2$$,
  'a writer rejects the suggestions instead'
);

select lives_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids), '[]'::jsonb,
    (select units from tests.plan), (select tenants from tests.plan))$$,
  'a property manager approves the tenants with the batch'
);

select isnt((tests.tenant((select nexus from tests.ids), 'Bean There')).id, null, 'the new tenant is created');
select is((tests.tenant((select nexus from tests.ids), 'Bean There')).whatsapp_verified, false, 'with its WhatsApp number unvalidated');
select is((tests.tenant((select nexus from tests.ids), 'Bean There')).account_reference, 'MSQ-T012', 'and its account reference');
select is(
  (select array_agg(r.record_type || ':' || r.row_number order by r.row_number, r.record_type) from tests.records((select batch from tests.ids)) r),
  array['tenant:2', 'tenant:3', 'unit:3'], 'every created tenant is listed against the batch with its row'
);
select is(
  (select r.unit_id from tests.records((select batch from tests.ids)) r where r.record_type = 'tenant' and r.row_number = 2),
  (select s01 from tests.ids), 'with the unit it is the tenant of'
);
select is(
  (select summary from tests.audit((tests.tenant((select nexus from tests.ids), 'Kwik Print')).id) where action = 'create'),
  'Tenant Kwik Print created by import of register.csv, row 3', 'each tenant is audited as created by import'
);
select ok(
  (select changes @> jsonb_build_array(jsonb_build_object('field', 'portfolioImportId', 'before', null, 'after', (select batch from tests.ids)))
   from tests.audit((tests.tenant((select nexus from tests.ids), 'Kwik Print')).id) where action = 'create'),
  'with the batch reference'
);
select is(
  (select summary from tests.audit((select batch from tests.ids)) where action = 'approve'),
  'Portfolio file register.csv approved: 0 properties, 1 unit and 2 tenants created', 'the approval counts the tenants created'
);
select is(tests.communications((select nexus from tests.ids)), (select messages from tests.ids), 'no message is created by importing tenants');

-- ------------------------------------------------------------------ the account reference is unique per company
select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, account_reference, contact_full_name, contact_role,
      contact_phone, whatsapp_number, industry)
    values ((select nexus from tests.ids), 'Other (Pty) Ltd', 'Other', 'pty_ltd', 'msq-t012', 'A', '', '+27820000000', '+27820000000', '')$$,
  '23505', null, 'a second tenant with the same account reference, whatever its case, is refused'
);

-- ------------------------------------------------------------------ members who only read cannot apply
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.apply_portfolio_import((select nexus from tests.ids), (select batch from tests.ids), '[]'::jsonb, '[]'::jsonb,
    (select tenants from tests.plan))$$,
  'P0002', null, 'a read-only member does not find the batch to apply'
);

select * from finish();
rollback;
