-- Lease management rules (PRD module 5, ticket M5-01): column grants, guards, verification reset on a changed
-- term, save_lease, no hard delete, audit.
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
-- Rows read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, created_at, id
$$;
create function tests.lease(p_reference text) returns public.leases
language sql security definer set search_path = '' as $$
  select * from public.leases where reference = p_reference
$$;

-- A vacant unit on Maponya Square, and an archived property with a unit, written as the database owner.
insert into public.units (id, company_id, property_id, unit_number, type, floor_area_sqm, occupancy_status)
values ('40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'S77', 'line_shop', 80, 'vacant');
insert into public.properties (id, company_id, name, code, type, address_line1, suburb, city, province, postal_code, gross_lettable_area_sqm, manager_user_id, accounting_system)
values ('30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Old Mill', 'OLM', 'retail', '1 Mill Road', 'Hammarsdale', 'Durban', 'KwaZulu-Natal', '3700', 900, '10000000-0000-4000-8000-000000000003', 'MRI');
insert into public.units (id, company_id, property_id, unit_number, type, floor_area_sqm, occupancy_status)
values ('40000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000a1', 'M01', 'line_shop', 300, 'vacant');
update public.properties set status = 'archived' where code = 'OLM';

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '30000000-0000-4000-8000-000000000001'::uuid as msq,
  '40000000-0000-4000-8000-0000000000a1'::uuid as s77,
  '50000000-0000-4000-8000-000000000003'::uuid as fresh_mart,
  '50000000-0000-4000-8000-000000000004'::uuid as kp_tenant,
  '40000000-0000-4000-8000-000000000004'::uuid as kp_unit,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi;
grant select on tests.ids to authenticated, service_role;

-- The body of a new lease, as the API sends it.
create function tests.new_lease(p_reference text, p_property uuid, p_unit uuid, p_tenant uuid) returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object(
    'reference', p_reference, 'property_id', p_property, 'unit_id', p_unit, 'tenant_id', p_tenant,
    'commencement_date', '2026-01-01', 'expiry_date', '2030-12-31',
    'initial_monthly_rental', 10000, 'current_monthly_rental', 10000, 'payment_due_day', 1,
    'escalation_type', 'percentage', 'escalation_percentage', 8, 'escalation_frequency', 'annual',
    'first_escalation_date', '2027-01-01', 'renewal_option_exists', true, 'renewal_term_months', 60,
    'renewal_notice_period_months', 6
  )
$$;
grant execute on function tests.new_lease(text, uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ a property manager creates a lease
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L077', (select msq from tests.ids), (select s77 from tests.ids), (select fresh_mart from tests.ids)))$$,
  'a property manager creates a lease through save_lease'
);
select is((tests.lease('MSQ-L077')).status::text, 'pending_verification', 'a new lease is pending verification unless stated');
select is((tests.lease('MSQ-L077')).verified, false, 'a new lease is unverified');
select is((select action::text || ' ' || summary from tests.audit((tests.lease('MSQ-L077')).id)), 'create Lease MSQ-L077 created',
  'creating a lease is audited');
select is((select actor_user_id from tests.audit((tests.lease('MSQ-L077')).id)), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L077', (select msq from tests.ids), (select s77 from tests.ids), (select fresh_mart from tests.ids)))$$,
  '23505', null, 'the reference is unique in the company'
);
select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L078', (select msq from tests.ids), '40000000-0000-4000-8000-0000000000a2', (select fresh_mart from tests.ids)))$$,
  'P0001', 'The unit is not in the selected property', 'the unit must be in the lease''s property'
);
select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L078', (select msq from tests.ids), (select kp_unit from tests.ids), (select fresh_mart from tests.ids)))$$,
  'P0001', 'The unit is not in the selected property', 'another company''s unit is refused'
);
select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L078', (select msq from tests.ids), (select s77 from tests.ids), (select kp_tenant from tests.ids)))$$,
  'P0001', 'The tenant is not in this workspace', 'another company''s tenant is refused'
);
select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('OLM-L001', '30000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', (select fresh_mart from tests.ids)))$$,
  'P0001', 'This property is archived. Restore it before adding leases to it.', 'no lease on an archived property'
);
select throws_ok(
  $$insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
      initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type, escalation_percentage,
      escalation_frequency, first_escalation_date, verified)
    values ((select nexus from tests.ids), 'MSQ-L079', (select msq from tests.ids), (select s77 from tests.ids), (select fresh_mart from tests.ids),
      '2026-01-01', '2030-12-31', 1, 1, 1, 'percentage', 8, 'annual', '2027-01-01', true)$$,
  '42501', null, 'a lease cannot be inserted verified'
);
select throws_ok(
  $$update public.leases set verified_by_user_id = (select naledi from tests.ids) where reference = 'MSQ-L077'$$,
  '42501', null, 'the verifier is not writable'
);
select throws_ok($$delete from public.leases where reference = 'MSQ-L077'$$, '42501', null, 'a writer cannot delete a lease');

-- ------------------------------------------------------------------ edits and verification
select lives_ok(
  $$select public.save_lease((select nexus from tests.ids), '{"notes": "Signed copy filed"}', (tests.lease('MSQ-L077')).id, false, null)$$,
  'a property manager edits a lease'
);
select is((tests.lease('MSQ-L077')).current_monthly_rental, 10000::numeric(14, 2), 'keys left out are unchanged');
update public.leases set verified = true, status = 'active' where reference = 'MSQ-L077';
select is((tests.lease('MSQ-L077')).verified, true, 'the lease is verified');

select lives_ok(
  $$select public.save_lease((select nexus from tests.ids), '{"notes": "Keys handed over"}', (tests.lease('MSQ-L077')).id, false, null)$$,
  'a note on a verified lease'
);
select is((tests.lease('MSQ-L077')).verified, true, 'changing a note keeps the verification');

select lives_ok(
  $$select public.save_lease((select nexus from tests.ids), '{"current_monthly_rental": 10800}', (tests.lease('MSQ-L077')).id, false, null)$$,
  'a rental change on a verified lease'
);
select is(
  (select row(verified, status::text, verified_by_user_id, verified_at)::text from public.leases where reference = 'MSQ-L077'),
  row(false, 'pending_verification', null::uuid, null::timestamptz)::text,
  'a changed term returns a verified lease to pending verification and clears the verifier'
);
select is(
  (select count(*) from tests.audit((tests.lease('MSQ-L077')).id)
   where summary = 'Lease MSQ-L077 terms changed; verification reset'
     and changes @> '[{"field":"current_monthly_rental","before":10000,"after":10800},{"field":"verified","before":true,"after":false}]'),
  1::bigint, 'the reset is audited with the changed term'
);

update public.leases set verified = true, status = 'active' where reference = 'MSQ-L077';
update public.leases set verified = true, expiry_date = '2031-12-31' where reference = 'MSQ-L077';
select is((tests.lease('MSQ-L077')).verified, false, 'a write cannot change a term and keep the verification');

-- ------------------------------------------------------------------ the bank guarantee
update public.leases set verified = true, status = 'active' where reference = 'MSQ-L077';
select lives_ok(
  $$select public.save_lease((select nexus from tests.ids), '{}', (tests.lease('MSQ-L077')).id, true,
      '{"bank": "Nedbank", "reference_number": "G-77", "amount": 30000, "basis_months": 3, "issued_on": "2026-01-01", "expires_on": "2031-03-31"}')$$,
  'a guarantee is added through save_lease'
);
select is((select amount from public.lease_bank_guarantees where reference_number = 'G-77'), 30000::numeric(14, 2), 'the guarantee is stored');
select is((tests.lease('MSQ-L077')).verified, false, 'a new guarantee on a verified lease needs verification again');
select is((select count(*) from tests.audit((tests.lease('MSQ-L077')).id) where summary = 'Lease MSQ-L077 bank guarantee added'), 1::bigint,
  'adding a guarantee is audited on the lease');

update public.leases set verified = true, status = 'active' where reference = 'MSQ-L077';
update public.lease_bank_guarantees set notes = 'Original at the office' where reference_number = 'G-77';
select is((tests.lease('MSQ-L077')).verified, true, 'a guarantee note keeps the verification');
select lives_ok(
  $$select public.save_lease((select nexus from tests.ids), '{}', (tests.lease('MSQ-L077')).id, true, null)$$,
  'the guarantee is removed through save_lease'
);
select is((select count(*) from public.lease_bank_guarantees where reference_number = 'G-77'), 0::bigint, 'the guarantee is gone');
select is((tests.lease('MSQ-L077')).verified, false, 'removing the guarantee of a verified lease needs verification again');

-- ------------------------------------------------------------------ parties of a lease in use
select throws_ok(
  $$update public.leases set tenant_id = (select fresh_mart from tests.ids) where reference = 'MSQ-L001'$$,
  'P0001', null, 'the parties of a lease with statements or a current unit cannot change'
);

-- ------------------------------------------------------------------ other roles and companies
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.save_lease((select nexus from tests.ids),
      tests.new_lease('MSQ-L080', (select msq from tests.ids), (select s77 from tests.ids), (select fresh_mart from tests.ids)))$$,
  '42501', null, 'a read-only member cannot create a lease'
);
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is(
  public.save_lease((select nexus from tests.ids), '{"notes": "x"}', (tests.lease('MSQ-L077')).id, false, null),
  null, 'another company''s member does not see the lease to change it'
);

select * from finish();
rollback;
