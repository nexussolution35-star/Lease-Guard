-- Unit management rules (PRD module 3): column grants, guards, no hard delete, audit.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(28);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Rows read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.unit(p_number text) returns public.units
language sql security definer set search_path = '' as $$
  select * from public.units where unit_number = p_number
$$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from public.properties where code = 'MSQ') as msq,
  (select id from public.properties where code = 'KGP') as kgp,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, msq, kgp, naledi) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ a property manager creates a unit
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    values ((select nexus from tests.ids), (select msq from tests.ids), 'U99', 'kiosk', 12.5)$$,
  'a property manager creates a unit'
);
select is((tests.unit('U99')).occupancy_status::text, 'vacant', 'a new unit is vacant unless stated');
select is((select action::text || ' ' || summary from tests.audit((tests.unit('U99')).id)), 'create Unit U99 created in Maponya Square',
  'creating a unit is audited');
select is((select actor_user_id from tests.audit((tests.unit('U99')).id)), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    values ((select nexus from tests.ids), (select msq from tests.ids), 'U99', 'kiosk', 10)$$,
  '23505', null, 'unit numbers are unique within a property'
);
select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm, current_tenant_id, current_lease_id)
    select (select nexus from tests.ids), (select msq from tests.ids), 'U98', 'kiosk', 10, l.tenant_id, l.id
    from public.leases l where l.reference = 'MSQ-L001'$$,
  '42501', null, 'the current tenant and lease are never typed in'
);

-- ------------------------------------------------------------------ edits
update public.units set occupancy_status = 'under_offer' where unit_number = 'U99';
select is((select summary from tests.audit((tests.unit('U99')).id) where action = 'update'),
  'Unit U99 in Maponya Square changed from vacant to under offer', 'an occupancy change is audited as such');
select is((select changes from tests.audit((tests.unit('U99')).id) where action = 'update'),
  '[{"field": "occupancy_status", "before": "vacant", "after": "under_offer"}]'::jsonb, 'with the status before and after');

update public.units set unit_number = 'U97', floor_area_sqm = 14 where unit_number = 'U99';
select is((select jsonb_agg(c ->> 'field' order by c ->> 'field') from tests.audit((tests.unit('U97')).id) a, jsonb_array_elements(a.changes) c
  where a.summary = 'Unit U97 in Maponya Square updated'), '["floor_area_sqm", "unit_number"]'::jsonb, 'an edit is audited with only the changed fields');
update public.units set unit_number = 'U97' where unit_number = 'U97';
select is((select count(*) from tests.audit((tests.unit('U97')).id) where action = 'update'), 2::bigint, 'an edit that changes nothing is not audited');

select throws_ok($$update public.units set unit_number = 'S01' where unit_number = 'U97'$$, '23505', null,
  'a unit cannot take a number already used in its property');
select throws_ok($$update public.units set property_id = (select msq from tests.ids) where unit_number = 'U97'$$, '42501', null,
  'the property is fixed after creation');
select throws_ok($$update public.units set current_lease_id = null, current_tenant_id = null where unit_number = 'S01'$$, '42501', null,
  'the current tenant and lease are not edited by people');

select throws_ok(
  $$update public.units set occupancy_status = 'vacant' where unit_number = 'S01'$$,
  'P0001', 'This unit has a current lease, so it stays occupied until the lease ends.', 'a unit with a current lease stays occupied'
);
select lives_ok($$update public.units set floor = 'Ground' where unit_number = 'S01'$$, 'other fields of a leased unit can change');

-- ------------------------------------------------------------------ archived property
-- A property without leases, with one unit, archived as the database owner.
reset role;
insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code,
    gross_lettable_area_sqm, manager_user_id, accounting_system)
  values ((select nexus from tests.ids), 'Archived Arcade', 'ARC', 'retail', '1 Road', 'Soweto', 'Johannesburg', 'Gauteng', '1804', 500,
    (select naledi from tests.ids), 'MRI');
insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
  select (select nexus from tests.ids), p.id, 'A01', 'line_shop', 50 from public.properties p where p.code = 'ARC';
update public.properties set status = 'archived' where code = 'ARC';
set local role authenticated;

select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    select (select nexus from tests.ids), p.id, 'A02', 'line_shop', 50 from public.properties p where p.code = 'ARC'$$,
  'P0001', 'This property is archived. Restore it before adding or changing its units.', 'no unit is added to an archived property'
);
select throws_ok(
  $$update public.units set occupancy_status = 'unavailable' where unit_number = 'A01'$$,
  'P0001', 'This property is archived. Restore it before adding or changing its units.', 'an archived property''s units are read-only'
);
update public.properties set status = 'active' where code = 'ARC';
select lives_ok($$update public.units set occupancy_status = 'unavailable' where unit_number = 'A01'$$, 'and editable again once it is restored');

-- ------------------------------------------------------------------ no hard delete
select throws_ok($$delete from public.units where unit_number = 'U97'$$, '42501', null, 'a writer cannot delete a unit');

-- ------------------------------------------------------------------ roles that only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
update public.units set occupancy_status = 'vacant' where unit_number = 'U97';
select is((tests.unit('U97')).occupancy_status::text, 'under_offer', 'a read-only member changes nothing');
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    values ((select nexus from tests.ids), (select msq from tests.ids), 'U96', 'kiosk', 10)$$,
  '42501', null, 'a property owner cannot add a unit'
);

-- ------------------------------------------------------------------ the other company
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
update public.units set unit_number = 'K99' where unit_number = 'K01';
select ok((tests.unit('K01')).id is not null, 'a writer of one company cannot change another company''s unit');
select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    values ((select kgalagadi from tests.ids), (select kgp from tests.ids), 'K02', 'kiosk', 10)$$,
  '42501', null, 'nor add a unit to another company''s property'
);
select throws_ok(
  $$insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
    values ((select nexus from tests.ids), (select kgp from tests.ids), 'K02', 'kiosk', 10)$$,
  '23503', null, 'a unit''s property must be in its company'
);

-- ------------------------------------------------------------------ background jobs (no signed-in user)
reset role;
select set_config('request.jwt.claims', '', true);
update public.units set floor = 'First' where unit_number = 'K01';
select is((select count(*) from public.audit_logs where entity_id = (tests.unit('K01')).id and action = 'update' and actor_user_id is null),
  1::bigint, 'a change without a signed-in user is audited, without an actor');
select throws_ok(
  $$update public.units set occupancy_status = 'vacant' where unit_number = 'S01'$$,
  'P0001', 'This unit has a current lease, so it stays occupied until the lease ends.', 'the occupancy rule also binds the service role'
);

select throws_ok(
  $$update public.units set company_id = (select kgalagadi from tests.ids) where unit_number = 'U97'$$,
  '23514', null, 'no role moves a unit to another company'
);

select * from finish();
rollback;
