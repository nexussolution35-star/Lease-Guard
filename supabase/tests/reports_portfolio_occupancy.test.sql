-- Reports: portfolio overview and occupancy (20261122031500_reports_portfolio_occupancy.sql, ticket R-01): the three
-- reporting functions answer every member role of the company with the figures the dashboard counts, refuse another
-- company and anonymous callers, and never write.
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

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_property_figures(uuid)', 'EXECUTE'), 'anon may not read property figures');
select ok(not has_function_privilege('anon', 'public.reports_arrears_accounts(uuid)', 'EXECUTE'), 'anon may not read arrears accounts');
select ok(not has_function_privilege('anon', 'public.reports_unit_occupancy(uuid)', 'EXECUTE'), 'anon may not read unit occupancy');
select is((select provolatile::text from pg_proc where proname = 'reports_property_figures'), 's', 'property figures are STABLE (read-only)');

set local role authenticated;

-- A read-only member of company A (Nexus Solution).
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select property_code, unit_count, occupied_units, vacant_units, active_leases, unverified_leases, monthly_rental_roll, open_events
    from public.reports_property_figures('20000000-0000-4000-8000-000000000001')$$,
  $$values ('MSQ'::text, 3::bigint, 3::bigint, 0::bigint, 1::bigint, 2::bigint, 12960.00::numeric, 1::bigint)$$,
  'per property: units, occupied, vacant, active leases (as the dashboard), unverified leases, verified rental roll, open events');

select results_eq(
  $$select tenant_id, statement_id, outstanding from public.reports_arrears_accounts('20000000-0000-4000-8000-000000000001')$$,
  $$values ('50000000-0000-4000-8000-000000000001'::uuid, '70000000-0000-4000-8000-000000000001'::uuid, 0.00::numeric)$$,
  'one account per tenant unit: its latest VERIFIED statement (the later one waits for review), balance settled');

select results_eq(
  $$select unit_number, occupancy_status::text, tenant_name, tenant_source, lease_reference
    from public.reports_unit_occupancy('20000000-0000-4000-8000-000000000001')$$,
  $$values ('S01'::text, 'occupied'::text, 'Dlamini Cellular'::text, 'lease'::text, 'MSQ-L001'::text),
           ('S02', 'occupied', 'Kasi Flame Grill', 'lease', 'WIP-L003'),
           ('S03', 'occupied', 'Fresh Mart', 'lease', 'DVC-L003')$$,
  'every unit with its status and current tenant from its lease');

-- The figures equal the dashboard's for the same data.
select is(
  (select sum(unit_count)::bigint from public.reports_property_figures('20000000-0000-4000-8000-000000000001')),
  (select count(*) from public.units where company_id = '20000000-0000-4000-8000-000000000001'),
  'units add up to the company''s units');
select is(
  (select coalesce(sum(outstanding) filter (where outstanding > 0), 0) from public.reports_arrears_accounts('20000000-0000-4000-8000-000000000001')),
  (select total_outstanding from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000001')),
  'positive balances add up to the dashboard''s total outstanding');

-- Another company is refused, not answered with zeros.
select throws_ok($$select * from public.reports_property_figures('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of company A cannot read company B''s property figures');
select throws_ok($$select * from public.reports_arrears_accounts('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its arrears accounts');
select throws_ok($$select * from public.reports_unit_occupancy('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its unit occupancy');

-- A property owner of company B reads company B, with its arrears.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select results_eq(
  $$select property_code, active_leases, monthly_rental_roll from public.reports_property_figures('20000000-0000-4000-8000-000000000002')$$,
  $$values ('KGP'::text, 1::bigint, 15000.00::numeric)$$,
  'a property owner of company B reads its property figures');
select results_eq(
  $$select outstanding from public.reports_arrears_accounts('20000000-0000-4000-8000-000000000002')$$,
  $$values (15000.00::numeric)$$,
  'and its outstanding balance');

-- A vacant unit has no current tenant; once a tenant is assigned to it, the tenant comes from the assignment.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.units (id, company_id, property_id, unit_number, type, floor_area_sqm, occupancy_status)
values ('40000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'S09', 'kiosk', 12, 'vacant');
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select results_eq(
  $$select occupancy_status::text, tenant_name, tenant_source from public.reports_unit_occupancy('20000000-0000-4000-8000-000000000001') where unit_number = 'S09'$$,
  $$values ('vacant'::text, null::text, null::text)$$,
  'a vacant unit has no current tenant');

reset role;
select set_config('request.jwt.claims', '', true);
insert into public.unit_tenant_assignments (company_id, property_id, unit_id, tenant_id)
values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select results_eq(
  $$select occupancy_status::text, tenant_name, tenant_source from public.reports_unit_occupancy('20000000-0000-4000-8000-000000000001') where unit_number = 'S09'$$,
  $$values ('occupied'::text, 'Fresh Mart'::text, 'assignment'::text)$$,
  'an assigned unit is occupied and its tenant comes from the assignment');

-- An archived property's units are left out of occupancy (as the dashboard); its figures are still returned, flagged.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.properties (id, company_id, name, code, type, address_line1, suburb, city, province, postal_code, gross_lettable_area_sqm, manager_user_id, accounting_system)
values ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', 'Old Mall', 'OLD', 'retail', '3 Main Road', 'Soweto', 'Johannesburg', 'Gauteng', '1804', 800, '10000000-0000-4000-8000-000000000003', 'MRI');
insert into public.units (id, company_id, property_id, unit_number, type, floor_area_sqm, occupancy_status)
values ('40000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000009', 'O01', 'line_shop', 80, 'vacant');
update public.properties set status = 'archived' where id = '30000000-0000-4000-8000-000000000009';
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*)::int from public.reports_unit_occupancy('20000000-0000-4000-8000-000000000001') where property_name = 'Old Mall'), 0,
  'units of an archived property are not counted');
select is((select property_status::text from public.reports_property_figures('20000000-0000-4000-8000-000000000001') where property_code = 'OLD'), 'archived',
  'an archived property is still returned, flagged, so a balance on it is never lost');

-- Not signed in.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_property_figures('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

select * from finish();
rollback;
