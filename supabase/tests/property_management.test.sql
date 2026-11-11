-- Property management rules (PRD module 2): column grants, guards, no hard delete, audit.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(33);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Audit rows read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.property(p_code text) returns public.properties
language sql security definer set search_path = '' as $$
  select * from public.properties where code = p_code
$$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from public.properties where code = 'MSQ') as msq,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from auth.users where email = 'thandi.mokoena@nexussolution.co.za') as thandi,
  (select id from auth.users where email = 'kabelo.molefe@nexussolution.co.za') as kabelo,
  (select id from auth.users where email = 'pieter@bothafamilytrust.co.za') as pieter;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, msq, naledi, thandi, kabelo, pieter) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ a property manager creates a property
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
      gross_lettable_area_sqm, manager_user_id, owner_user_id, accounting_system)
    values ((select nexus from tests.ids), 'Rosebank Corner', 'RBC', 'office', '1 Cradock Avenue', 'Rosebank', 'Johannesburg',
      'Gauteng', '2196', 4200, (select naledi from tests.ids), (select pieter from tests.ids), 'Sage')$$,
  'a property manager creates a property'
);
select is((select action::text || ' ' || summary from tests.audit((tests.property('RBC')).id)), 'create Property Rosebank Corner (RBC) created',
  'creating a property is audited');
select is((select actor_user_id from tests.audit((tests.property('RBC')).id)), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
      gross_lettable_area_sqm, manager_user_id, accounting_system)
    values ((select nexus from tests.ids), 'Duplicate', 'RBC', 'office', '1 Road', 'X', 'Y', 'Gauteng', '2000', 10, (select naledi from tests.ids), 'MRI')$$,
  '23505', null, 'codes are unique within a company'
);
select throws_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
      gross_lettable_area_sqm, manager_user_id, accounting_system)
    values ((select nexus from tests.ids), 'Read-only manager', 'ROM', 'office', '1 Road', 'X', 'Y', 'Gauteng', '2000', 10, (select kabelo from tests.ids), 'MRI')$$,
  'P0001', 'The property manager must be a company admin or property manager of this workspace',
  'the manager must be a company admin or property manager'
);
select throws_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
      gross_lettable_area_sqm, manager_user_id, accounting_system, status)
    values ((select nexus from tests.ids), 'Born archived', 'BAR', 'office', '1 Road', 'X', 'Y', 'Gauteng', '2000', 10, (select naledi from tests.ids), 'MRI', 'archived')$$,
  'P0001', 'A new property cannot start archived', 'a new property cannot start archived'
);

-- ------------------------------------------------------------------ edits
update public.properties set name = 'Rosebank Corner Offices', gross_lettable_area_sqm = 4300 where code = 'RBC';
select is((select summary from tests.audit((tests.property('RBC')).id) where action = 'update'), 'Property Rosebank Corner Offices updated',
  'an edit is audited');
select is((select jsonb_agg(c ->> 'field' order by c ->> 'field') from tests.audit((tests.property('RBC')).id) a, jsonb_array_elements(a.changes) c
  where a.action = 'update'), '["gross_lettable_area_sqm", "name"]'::jsonb, 'with only the changed fields');
update public.properties set name = 'Rosebank Corner Offices' where code = 'RBC';
select is((select count(*) from tests.audit((tests.property('RBC')).id) where action = 'update'), 1::bigint, 'an edit that changes nothing is not audited');

select throws_ok($$update public.properties set code = 'RBX' where code = 'RBC'$$, '42501', null, 'the code is fixed after creation');
select throws_ok(
  $$update public.properties set manager_user_id = (select pieter from tests.ids) where code = 'RBC'$$,
  'P0001', 'The property manager must be a company admin or property manager of this workspace',
  'a property owner cannot become the manager'
);
select lives_ok($$update public.properties set manager_user_id = (select thandi from tests.ids) where code = 'RBC'$$,
  'a company admin can become the manager');

-- ------------------------------------------------------------------ archive and restore
select throws_ok(
  $$update public.properties set status = 'archived' where code = 'MSQ'$$,
  'P0001', 'This property still has leases that have not ended. End or terminate them before archiving the property.',
  'a property with leases that have not ended cannot be archived'
);
select is((tests.property('MSQ')).status::text, 'active', 'and stays active');

update public.properties set status = 'archived' where code = 'RBC';
select is((tests.property('RBC')).status::text, 'archived', 'a property without live leases is archived');
select is((select summary from tests.audit((tests.property('RBC')).id) where action = 'archive'), 'Property Rosebank Corner Offices archived',
  'archiving is audited as an archive');
select throws_ok(
  $$update public.properties set name = 'Renamed while archived' where code = 'RBC'$$,
  'P0001', 'This property is archived. Restore it before changing it.', 'an archived property is read-only'
);
select throws_ok(
  $$update public.properties set status = 'active', name = 'Restored and renamed' where code = 'RBC'$$,
  'P0001', 'This property is archived. Restore it before changing it.', 'restoring cannot carry other changes'
);
select throws_ok(
  $$update public.properties set status = 'under_development' where code = 'RBC'$$,
  'P0001', 'This property is archived. Restore it before changing it.', 'an archived property is restored to active only'
);
update public.properties set status = 'active' where code = 'RBC';
select is((select count(*) from tests.audit((tests.property('RBC')).id) where summary = 'Property Rosebank Corner Offices restored'), 1::bigint,
  'restoring is audited');

-- ------------------------------------------------------------------ which leases block archiving
-- A unit and one lease on RBC, written as the database owner; the lease's status is then varied.
reset role;
insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm, occupancy_status)
  values ((select nexus from tests.ids), (tests.property('RBC')).id, 'R01', 'office_suite', 100, 'vacant');
insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
    initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type, escalation_percentage,
    escalation_frequency, first_escalation_date, status)
  select (select nexus from tests.ids), 'RBC-L001', (tests.property('RBC')).id, u.id,
    (select id from public.tenants where company_id = (select nexus from tests.ids) order by id limit 1),
    '2024-01-01', '2025-12-31', 10000, 10000, 1, 'percentage', 8, 'annual', '2025-01-01', 'draft'
  from public.units u where u.unit_number = 'R01' and u.property_id = (tests.property('RBC')).id;
select throws_ok($$update public.properties set status = 'archived' where code = 'RBC'$$, 'P0001', null, 'a draft lease blocks archiving');
update public.leases set status = 'pending_verification' where reference = 'RBC-L001';
select throws_ok($$update public.properties set status = 'archived' where code = 'RBC'$$, 'P0001', null, 'a lease pending verification blocks archiving');
update public.leases set status = 'expiring' where reference = 'RBC-L001';
select throws_ok($$update public.properties set status = 'archived' where code = 'RBC'$$, 'P0001', null, 'an expiring lease blocks archiving');
update public.leases set status = 'expired' where reference = 'RBC-L001';
select lives_ok($$update public.properties set status = 'archived' where code = 'RBC'$$, 'a property whose leases have all ended can be archived');
update public.properties set status = 'active' where code = 'RBC';
set local role authenticated;

-- ------------------------------------------------------------------ no hard delete
select throws_ok($$delete from public.properties where code = 'RBC'$$, '42501', null, 'a writer cannot delete a property');

-- ------------------------------------------------------------------ roles that only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
update public.properties set name = 'Changed by read only' where code = 'RBC';
select is((tests.property('RBC')).name, 'Rosebank Corner Offices', 'a read-only member changes nothing');
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
update public.properties set name = 'Changed by owner' where code = 'RBC';
select is((tests.property('RBC')).name, 'Rosebank Corner Offices', 'a property owner changes nothing');

-- ------------------------------------------------------------------ the other company
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
update public.properties set name = 'Changed across companies' where code = 'KGP';
reset role;
select is((tests.property('KGP')).name, 'Kgalagadi Park', 'a writer of one company cannot change another company''s property');
-- Inserting into a company the caller cannot write is refused before any of that company's members are looked up.
set local role authenticated;
select throws_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
      gross_lettable_area_sqm, manager_user_id, accounting_system)
    values ((select kgalagadi from tests.ids), 'Probe', 'PRB', 'office', '1 Road', 'X', 'Y', 'Gauteng', '2000', 10,
      (select id from auth.users where email = 'lerato@kgalagadiproperty.co.za'), 'MRI')$$,
  '42501', null, 'another company''s member roles cannot be probed through the manager rule'
);
reset role;
select is((select count(*) from public.audit_logs where company_id = (select kgalagadi from tests.ids) and entity_type = 'property' and action <> 'create'), 0::bigint,
  'nothing was audited in the other company');

-- ------------------------------------------------------------------ background jobs (no signed-in user)
select set_config('request.jwt.claims', '', true);
update public.properties set description = 'Updated by a job' where code = 'KGP';
select is((select count(*) from public.audit_logs where entity_id = (tests.property('KGP')).id and action = 'update' and actor_user_id is null),
  1::bigint, 'a change without a signed-in user is audited, without an actor');
select throws_ok(
  $$update public.properties set status = 'archived' where code = 'KGP'$$,
  'P0001', 'This property still has leases that have not ended. End or terminate them before archiving the property.',
  'the archive rule also binds the service role'
);

select * from finish();
rollback;
