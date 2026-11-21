-- Reports: arrears and payment arrangements (20261122050500_reports_arrears_arrangements.sql, ticket R-05): the three
-- reporting functions answer every member role of the company with the latest verified balance per account (the
-- dashboard's figures), every arrangement with its instalments and the monitoring configuration; they refuse another
-- company and anonymous callers, and never write.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(16);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_arrears_detail(uuid)', 'EXECUTE'), 'anon may not read arrears detail');
select ok(not has_function_privilege('anon', 'public.reports_payment_arrangements(uuid)', 'EXECUTE'), 'anon may not read payment arrangements');
select ok(not has_function_privilege('anon', 'public.reports_arrears_settings(uuid)', 'EXECUTE'), 'anon may not read arrears settings');
select is((select provolatile::text from pg_proc where proname = 'reports_payment_arrangements'), 's', 'payment arrangements are STABLE (read-only)');

set local role authenticated;

-- A property owner of company B (Kgalagadi Property): one account in arrears and one active arrangement.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);

select results_eq(
  $$select tenant_name, property_name, unit_number, lease_reference, statement_date, outstanding
    from public.reports_arrears_detail('20000000-0000-4000-8000-000000000002')$$,
  $$values ('Arcadia Books'::text, 'Kgalagadi Park'::text, 'K01'::text, 'KGP-L001'::text, '2026-10-31'::date, 15000.00::numeric)$$,
  'the latest verified statement of each account, with the tenant, property, unit and lease names');
select is(
  (select coalesce(sum(outstanding) filter (where outstanding > 0), 0) from public.reports_arrears_detail('20000000-0000-4000-8000-000000000002')),
  (select total_outstanding from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000002')),
  'positive balances add up to the dashboard''s total outstanding');
select is(
  (select count(distinct tenant_id) filter (where outstanding > 0) from public.reports_arrears_detail('20000000-0000-4000-8000-000000000002')),
  (select tenants_in_arrears from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000002')),
  'and its tenants to the dashboard''s tenants in arrears');

select results_eq(
  $$select tenant_name, unit_number, lease_reference, status::text, outstanding_balance, installment_amount, suppress_arrears_reminders,
           jsonb_array_length(installments), installments -> 0 ->> 'dueDate', (installments -> 0 ->> 'amount')::numeric, installments -> 0 ->> 'status'
    from public.reports_payment_arrangements('20000000-0000-4000-8000-000000000002')$$,
  $$values ('Arcadia Books'::text, 'K01'::text, 'KGP-L001'::text, 'active'::text, 15000.00::numeric, 5000.00::numeric, true,
            1, '2026-11-15'::text, 5000.00::numeric, 'scheduled'::text)$$,
  'every arrangement with its names and its instalments');

select results_eq(
  $$select arrears_config, arrangement_attention_config from public.reports_arrears_settings('20000000-0000-4000-8000-000000000002')$$,
  $$values (null::jsonb, null::jsonb)$$,
  'no arrears rules configured: both configs are null (the report uses the defaults)');

-- A read-only member of company A (Nexus Solution): the settled account is returned with a zero balance.
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select results_eq(
  $$select tenant_name, outstanding from public.reports_arrears_detail('20000000-0000-4000-8000-000000000001')$$,
  $$values ('Dlamini Cellular'::text, 0.00::numeric)$$,
  'a read-only member reads the latest verified balance, settled (the statement waiting for review does not count)');

-- Once rules are configured, their configs are returned; cancelled and completed arrangements are returned as well.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.monitoring_rules (company_id, event_type, name, description, default_priority, config)
values
  ('20000000-0000-4000-8000-000000000001', 'arrears', 'Arrears', 'Arrears ageing', 'high', '{"kind":"arrears","minimumBalanceRands":100,"ageingBucketsDays":[30,60,90]}'),
  ('20000000-0000-4000-8000-000000000001', 'arrangement_attention', 'Arrangements', 'Missed instalments', 'high', '{"kind":"arrangement_attention","graceDays":3}');
update public.payment_arrangements set status = 'cancelled', closed_on = '2026-11-10', close_reason = 'Settled in full', closed_by_user_id = '10000000-0000-4000-8000-000000000003'
where id = '80000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select results_eq(
  $$select arrears_config -> 'ageingBucketsDays', (arrangement_attention_config ->> 'graceDays')::int
    from public.reports_arrears_settings('20000000-0000-4000-8000-000000000001')$$,
  $$values ('[30,60,90]'::jsonb, 3)$$,
  'the company''s ageing buckets and grace days');
select results_eq(
  $$select status::text, closed_on from public.reports_payment_arrangements('20000000-0000-4000-8000-000000000001')$$,
  $$values ('cancelled'::text, '2026-11-10'::date)$$,
  'a cancelled arrangement is still returned, with the date it closed');

-- Another company is refused, not answered with zeros.
select throws_ok($$select * from public.reports_arrears_detail('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of company A cannot read company B''s arrears');
select throws_ok($$select * from public.reports_payment_arrangements('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its payment arrangements');
select throws_ok($$select * from public.reports_arrears_settings('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its monitoring configuration');

-- Not signed in.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_payment_arrangements('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

select * from finish();
rollback;
