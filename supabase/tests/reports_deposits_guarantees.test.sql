-- Reports: deposits and guarantees (20261122071500_reports_deposits_guarantees.sql, ticket R-04): the two reporting
-- functions answer every member role of the company with its leases' deposits and guarantees and the guarantee expiry
-- notice days lease monitoring uses, refuse another company and anonymous callers, and never write.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(14);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_lease_security(uuid)', 'EXECUTE'), 'anon may not read lease security');
select ok(not has_function_privilege('anon', 'public.reports_guarantee_notice_days(uuid)', 'EXECUTE'), 'anon may not read the notice days');
select is((select provolatile::text from pg_proc where proname = 'reports_lease_security'), 's', 'lease security is STABLE (read-only)');

set local role authenticated;

-- A read-only member of company A (Nexus Solution).
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select reference, lease_status::text, verified, tenant_name, unit_number, initial_monthly_rental, escalation_type::text,
           escalation_percentage, first_escalation_date, deposit_amount, guarantee_bank, guarantee_amount, guarantee_basis_months,
           guarantee_expires_on, guarantee_status::text
    from public.reports_lease_security('20000000-0000-4000-8000-000000000001')$$,
  $$values ('MSQ-L001'::text, 'active'::text, true, 'Dlamini Cellular'::text, 'S01'::text, 12000.00::numeric, 'percentage'::text,
            8.000::numeric, '2025-01-01'::date, null::numeric, 'Standard Bank'::text, 36000.00::numeric, 3.00::numeric,
            '2029-03-31'::date, 'active'::text)$$,
  'the lease with a guarantee, with its terms and guarantee; leases with neither a deposit nor a guarantee are left out');

select results_eq(
  $$select company_notice_days, rule_notice_days from public.reports_guarantee_notice_days('20000000-0000-4000-8000-000000000001')$$,
  $$values ('{90,30}'::integer[], null::jsonb)$$,
  'the company''s guarantee expiry notice days, and no rule');

-- A deposit on an unverified lease is returned too, flagged unverified (the domain counts it as excluded).
reset role;
select set_config('request.jwt.claims', '', true);
update public.leases set deposit_amount = 18000, deposit_basis_months = 2, deposit_held_by = 'landlord', deposit_interest_bearing = true
where id = '60000000-0000-4000-8000-000000000002';
insert into public.monitoring_rules (company_id, event_type, name, description, default_priority, config)
values ('20000000-0000-4000-8000-000000000001', 'guarantee_expiry', 'Guarantee expiry', 'Guarantee expiry notices', 'high', '{"kind":"guarantee_expiry","noticeDays":[60,14]}');
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select reference, verified, deposit_amount, deposit_basis_months, deposit_held_by::text, guarantee_amount
    from public.reports_lease_security('20000000-0000-4000-8000-000000000001') where reference = 'WIP-L003'$$,
  $$values ('WIP-L003'::text, false, 18000.00::numeric, 2.00::numeric, 'landlord'::text, null::numeric)$$,
  'a deposit on an unverified lease is returned, flagged unverified');
select is((select count(*)::int from public.reports_lease_security('20000000-0000-4000-8000-000000000001')), 2,
  'one row per lease with a deposit or a guarantee');
select results_eq(
  $$select rule_notice_days from public.reports_guarantee_notice_days('20000000-0000-4000-8000-000000000001')$$,
  $$values ('[60, 14]'::jsonb)$$,
  'the guarantee expiry rule''s notice days, as lease monitoring reads them');

-- Another company is refused, not answered with nothing.
select throws_ok($$select * from public.reports_lease_security('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of company A cannot read company B''s lease security');
select throws_ok($$select * from public.reports_guarantee_notice_days('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its notice days');

-- A property owner of company B reads company B.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select results_eq(
  $$select reference, guarantee_bank, guarantee_amount from public.reports_lease_security('20000000-0000-4000-8000-000000000002')$$,
  $$values ('KGP-L001'::text, 'Absa'::text, 45000.00::numeric)$$,
  'a property owner of company B reads its lease security');
select results_eq(
  $$select company_notice_days, rule_notice_days from public.reports_guarantee_notice_days('20000000-0000-4000-8000-000000000002')$$,
  $$values ('{90,30}'::integer[], null::jsonb)$$,
  'and its own notice days, without company A''s rule');

-- Not signed in.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_lease_security('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

-- Nothing was written by reading.
reset role;
select is((select count(*)::int from public.leases where company_id = '20000000-0000-4000-8000-000000000001' and deposit_amount is not null), 1,
  'reading changed no lease');

select * from finish();
rollback;
