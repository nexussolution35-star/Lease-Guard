-- Assigning a tenant to a unit (ticket M4-04): writers assign and unassign through the functions, the unit follows
-- (occupied, current tenant), conflicts name who holds the unit, history kept, leases of an assigned unit are for the
-- assigned tenant, audit, grants, roles and companies.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(50);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.unit(p_number text) returns public.units
language sql security definer set search_path = '' as $$
  select * from public.units where unit_number = p_number
$$;
create function tests.current(p_number text) returns public.unit_tenant_assignments
language sql security definer set search_path = '' as $$
  select a.* from public.unit_tenant_assignments a join public.units u on u.id = a.unit_id
  where u.unit_number = p_number and a.ended_at is null
$$;
create function tests.assignments(p_number text) returns setof public.unit_tenant_assignments
language sql security definer set search_path = '' as $$
  select a.* from public.unit_tenant_assignments a join public.units u on u.id = a.unit_id where u.unit_number = p_number
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from public.properties where code = 'MSQ') as msq,
  (select id from public.tenants where trading_name = 'Dlamini Cellular') as dlamini,
  (select id from public.tenants where trading_name = 'Kasi Flame Grill') as kasi,
  (select id from public.tenants where trading_name = 'Fresh Mart') as fresh_mart,
  (select id from public.tenants where trading_name = 'Arcadia Books') as arcadia,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, msq, dlamini, kasi, fresh_mart, arcadia, naledi) = 0 from tests.ids), 'every fixture exists');
create table tests.counts as select
  (select count(*) from public.communications) as communications,
  (select count(*) from public.monitoring_events) as events;

-- Vacant units to assign, and one in a property that will be archived.
insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
select nexus, msq, n, 'line_shop', 50 from tests.ids, unnest(array['A01', 'A02', 'A03', 'A04']) as n;
insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province, postal_code, gross_lettable_area_sqm, manager_user_id, accounting_system)
select nexus, 'Old Mill', 'OLD', 'retail', '1 Mill Road', 'Newtown', 'Johannesburg', 'Gauteng', '2001', 500, naledi, 'MRI' from tests.ids;
insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm)
select nexus, (select id from public.properties where code = 'OLD'), 'M01', 'line_shop', 40 from tests.ids;
update public.properties set status = 'archived' where code = 'OLD';

-- ------------------------------------------------------------------ a property manager assigns
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('A01')).id)$$,
  'a property manager assigns a tenant to a unit'
);
select is((tests.unit('A01')).occupancy_status::text, 'occupied', 'the unit is occupied straight away');
select is((tests.unit('A01')).current_tenant_id, (select kasi from tests.ids), 'the assigned tenant is the unit''s current tenant');
select is((tests.unit('A01')).current_lease_id, null, 'without a lease');
select is((tests.current('A01')).assigned_by_user_id, (select naledi from tests.ids), 'who assigned is stamped');
select is((tests.current('A01')).property_id, (select msq from tests.ids), 'the property is taken from the unit');
select is(
  (select summary from tests.audit((tests.unit('A01')).id) where summary like '%assigned%'),
  'Kasi Flame Grill assigned to unit A01 in Maponya Square', 'assigning is audited on the unit'
);
select is(
  (select actor_user_id from tests.audit((tests.unit('A01')).id) where summary like '%assigned%'),
  (select naledi from tests.ids), 'by the signed-in user'
);
select is(
  (select jsonb_agg(c ->> 'field' order by c ->> 'field') from tests.audit((tests.unit('A01')).id) a, jsonb_array_elements(a.changes) c
   where a.summary like '%assigned%'),
  '["assignmentId", "propertyId", "tenant", "tenantId"]'::jsonb, 'with the tenant, the property and the assignment'
);

select is(
  public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('A01')).id),
  (tests.current('A01')).id, 'assigning the holder again returns the same assignment'
);
select is((select count(*) from tests.assignments('A01')), 1::bigint, 'and adds nothing');

select lives_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('A02')).id)$$,
  'a tenant can hold several units'
);
select is((select count(*) from public.unit_tenant_assignments where tenant_id = (select kasi from tests.ids) and ended_at is null), 2::bigint,
  'both assignments are current');

-- ------------------------------------------------------------------ conflicts name who holds the unit
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select dlamini from tests.ids), (tests.unit('A01')).id)$$,
  'P0001', 'Unit A01 is assigned to Kasi Flame Grill. Unassign it before assigning it to another tenant.',
  'a unit assigned to another tenant must be unassigned first'
);
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('S01')).id)$$,
  'P0001', 'Unit S01 is let to Dlamini Cellular under lease MSQ-L001. It cannot be assigned to another tenant while that lease is in place.',
  'a unit let to another tenant cannot be assigned'
);
select lives_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select dlamini from tests.ids), (tests.unit('S01')).id)$$,
  'the lease''s own tenant can be assigned to its unit'
);
select is((tests.unit('S01')).current_tenant_id, (select dlamini from tests.ids), 'the current lease''s tenant stays the current tenant');
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('M01')).id)$$,
  'P0001', 'Property Old Mill is archived. Restore it before assigning its units.',
  'units of an archived property cannot be assigned'
);
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select arcadia from tests.ids), (tests.unit('A03')).id)$$,
  'P0002', 'The tenant is not in this workspace', 'another company''s tenant cannot be assigned'
);
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (select id from public.units where unit_number = 'K01'))$$,
  'P0002', 'The unit is not in this workspace', 'another company''s unit is not found'
);
select throws_ok(
  $$update public.units set occupancy_status = 'vacant' where unit_number = 'A01'$$,
  'P0001', 'This unit is assigned to Kasi Flame Grill, so it stays occupied until it is unassigned.',
  'an assigned unit stays occupied'
);

-- ------------------------------------------------------------------ no direct writes
select throws_ok(
  $$insert into public.unit_tenant_assignments (company_id, unit_id, tenant_id)
    values ((select nexus from tests.ids), (tests.unit('A03')).id, (select kasi from tests.ids))$$,
  '42501', null, 'signed-in users never insert assignments directly'
);
select throws_ok(
  $$update public.unit_tenant_assignments set ended_at = now() where unit_id = (tests.unit('A01')).id$$,
  '42501', null, 'nor end them directly'
);
select throws_ok(
  $$delete from public.unit_tenant_assignments where unit_id = (tests.unit('A01')).id$$,
  '42501', null, 'nor delete them'
);
select throws_ok(
  $$update public.units set current_tenant_id = null where unit_number = 'A01'$$,
  '42501', null, 'the current tenant is not edited by people'
);

-- ------------------------------------------------------------------ one current assignment per unit (not only the guard)
select ok(
  exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'unit_tenant_assignments_current_unit_key' and i.indisunique
      and pg_get_expr(i.indpred, i.indrelid) = '(ended_at IS NULL)'
  ),
  'a partial unique index allows one current assignment per unit, so two writers at once cannot both assign it'
);
select ok(
  pg_get_functiondef('private.guard_unit_tenant_assignment()'::regprocedure) ~* 'for update'
    and pg_get_functiondef('private.guard_lease_unit_assignment()'::regprocedure) ~* 'for no key update',
  'assigning and a lease of the unit lock the unit, so neither misses the other committed at the same time'
);

-- ------------------------------------------------------------------ unassign
select lives_ok(
  $$select public.end_unit_tenant_assignment((select nexus from tests.ids), (tests.current('A02')).id)$$,
  'a property manager unassigns a unit'
);
select is((tests.unit('A02')).occupancy_status::text, 'vacant', 'the unit returns to vacant');
select is((tests.unit('A02')).current_tenant_id, null, 'and has no current tenant');
select is((select count(*) from tests.assignments('A02') where ended_at is not null and ended_by_user_id = (select naledi from tests.ids)),
  1::bigint, 'the assignment is kept as history, with who ended it');
select is(
  (select summary from tests.audit((tests.unit('A02')).id) where summary like '%unassigned%'),
  'Kasi Flame Grill unassigned from unit A02 in Maponya Square', 'unassigning is audited on the unit'
);
select throws_ok(
  $$select public.end_unit_tenant_assignment((select nexus from tests.ids), (select id from tests.assignments('A02')))$$,
  'P0001', 'This assignment has already ended.', 'an ended assignment cannot be ended again'
);
select throws_ok(
  $$select public.end_unit_tenant_assignment((select kgalagadi from tests.ids), (tests.current('A01')).id)$$,
  '42501', null, 'a member who cannot write the company is refused'
);

-- ------------------------------------------------------------------ roles and companies
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('A03')).id)$$,
  '42501', 'Only company admins and property managers can assign tenants to units', 'read-only members cannot assign'
);
select throws_ok(
  $$select public.end_unit_tenant_assignment((select nexus from tests.ids), (tests.current('A01')).id)$$,
  '42501', 'Only company admins and property managers can unassign tenants from units', 'nor unassign'
);
select is((select count(*) from public.unit_tenant_assignments), 3::bigint, 'members read the company''s assignments');

select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select kasi from tests.ids), (tests.unit('A03')).id)$$,
  '42501', null, 'property owners cannot assign'
);

select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is((select count(*) from public.unit_tenant_assignments), 0::bigint, 'another company sees no assignments');

-- ------------------------------------------------------------------ leases of an assigned unit (every role)
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
      initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type, escalation_percentage,
      escalation_frequency, first_escalation_date)
    values ((select nexus from tests.ids), 'MSQ-A01X', (select msq from tests.ids), (tests.unit('A01')).id, (select dlamini from tests.ids),
      '2027-01-01', '2031-12-31', 1, 1, 1, 'percentage', 8, 'annual', '2028-01-01')$$,
  'P0001', 'Unit A01 is assigned to Kasi Flame Grill, so its lease must be for Kasi Flame Grill. Unassign the unit first to let it to another tenant.',
  'a lease of an assigned unit for another tenant is refused'
);
select lives_ok(
  $$insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
      initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type, escalation_percentage,
      escalation_frequency, first_escalation_date, status, verified, verified_by_user_id, verified_at)
    values ((select nexus from tests.ids), 'MSQ-A01', (select msq from tests.ids), (tests.unit('A01')).id, (select kasi from tests.ids),
      '2026-01-01', '2030-12-31', 1, 1, 1, 'percentage', 8, 'annual', '2027-01-01', 'active', true, (select naledi from tests.ids), now())$$,
  'a lease of an assigned unit for the assigned tenant is added'
);
select throws_ok(
  $$update public.leases set tenant_id = (select dlamini from tests.ids) where reference = 'MSQ-A01'$$,
  'P0001', null, 'and its tenant cannot move away from the assignment'
);

-- A lease of another tenant added before the assignment cannot become active while the unit is assigned.
insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
  initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type, escalation_percentage,
  escalation_frequency, first_escalation_date)
values ((select nexus from tests.ids), 'MSQ-A03', (select msq from tests.ids), (tests.unit('A03')).id, (select dlamini from tests.ids),
  '2026-01-01', '2030-12-31', 1, 1, 1, 'percentage', 8, 'annual', '2027-01-01');
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select lives_ok(
  $$select public.assign_tenant_to_unit((select nexus from tests.ids), (select fresh_mart from tests.ids), (tests.unit('A03')).id)$$,
  'a unit whose other-tenant lease is not in force can be assigned'
);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$update public.leases set verified = true, status = 'active', verified_by_user_id = (select naledi from tests.ids), verified_at = now() where reference = 'MSQ-A03'$$,
  'P0001', null, 'that lease cannot become active while the unit is assigned to someone else'
);

-- An active lease keeps the unit occupied after unassigning.
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select lives_ok(
  $$select public.end_unit_tenant_assignment((select nexus from tests.ids), (tests.current('A01')).id)$$,
  'a unit with an active lease is unassigned'
);
select is((tests.unit('A01')).occupancy_status::text, 'occupied', 'and stays occupied for its lease');

-- The record itself is fixed (every role).
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$update public.unit_tenant_assignments set tenant_id = (select dlamini from tests.ids) where unit_id = (tests.unit('A03')).id$$,
  'P0001', 'An assignment''s tenant, unit and start are fixed. Unassign the unit and assign it again.', 'an assignment''s tenant is fixed'
);
select throws_ok(
  $$update public.unit_tenant_assignments set ended_at = null where unit_id = (tests.unit('A02')).id$$,
  'P0001', 'This assignment has already ended.', 'an ended assignment stays ended'
);
select ok(
  (select communications = (select count(*) from public.communications) and events = (select count(*) from public.monitoring_events) from tests.counts),
  'assigning and unassigning write no communication or monitoring event'
);

select * from finish();
rollback;
