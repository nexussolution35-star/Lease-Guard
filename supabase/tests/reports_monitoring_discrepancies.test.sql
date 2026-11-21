-- Reports: lease monitoring and rental discrepancies (20261122053000_reports_monitoring_discrepancies.sql, ticket
-- R-02): the three reporting functions answer every member role of the company with the company's own events, leases
-- and billed rentals, pick each lease's billed statement as the lease monitoring scan does, refuse another company and
-- anonymous callers, and never write.
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

-- A discrepancy event on NS's verified September statement, as the lease monitoring scan raises it.
insert into public.monitoring_events (company_id, type, property_id, unit_id, tenant_id, lease_id, lease_reference, statement_id, title, description, calculation, identified_on, priority, recommended_action, status)
values ('20000000-0000-4000-8000-000000000001', 'rental_escalation_discrepancy', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'MSQ-L001', '70000000-0000-4000-8000-000000000001',
  'Rental under-charged', 'Billed R12 960', '{"expectedAmount":13996.8,"actualAmount":12960,"difference":1036.8,"steps":["Initial rental R 12 000,00"]}',
  '2026-11-02', 'high', 'Correct the billed rental', 'new');
-- A company rule with a tolerance.
insert into public.monitoring_rules (company_id, event_type, name, description, default_priority, config)
values ('20000000-0000-4000-8000-000000000001', 'rental_escalation_discrepancy', 'Rental escalation', 'Billed vs contractual', 'high',
  '{"kind":"rental_escalation_discrepancy","toleranceRands":50,"tolerancePercent":0}');

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_monitoring_events(uuid)', 'EXECUTE'), 'anon may not read monitoring events');
select ok(not has_function_privilege('anon', 'public.reports_rental_comparisons(uuid)', 'EXECUTE'), 'anon may not read rental comparisons');
select ok(not has_function_privilege('anon', 'public.reports_discrepancy_rule(uuid)', 'EXECUTE'), 'anon may not read the discrepancy rule');
select is((select provolatile::text from pg_proc where proname = 'reports_rental_comparisons'), 's', 'rental comparisons are STABLE (read-only)');

set local role authenticated;

-- A read-only member of company A (Nexus Solution).
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select event_type::text, status::text, property_name, unit_number, tenant_name, lease_reference
    from public.reports_monitoring_events('20000000-0000-4000-8000-000000000001')$$,
  $$values ('lease_expiry'::text, 'new'::text, 'Maponya Square'::text, 'S01'::text, 'Dlamini Cellular'::text, 'MSQ-L001'::text),
           ('rental_escalation_discrepancy', 'new', 'Maponya Square', 'S01', 'Dlamini Cellular', 'MSQ-L001')$$,
  'every event of the company with its property, unit and tenant names, oldest identified first');
select results_eq(
  $$select statement_date, statement_period_start, (calculation ->> 'difference')::numeric
    from public.reports_monitoring_events('20000000-0000-4000-8000-000000000001') where statement_id is not null$$,
  $$values ('2026-09-30'::date, '2026-09-01'::date, 1036.8::numeric)$$,
  'an event naming a statement carries the statement''s date, billed period and its calculation');
select is(
  (select count(*)::int from public.reports_monitoring_events('20000000-0000-4000-8000-000000000001')
   where status in ('new', 'under_review', 'action_required', 'in_progress')),
  (select count(*)::int from public.monitoring_events where company_id = '20000000-0000-4000-8000-000000000001'
   and status in ('new', 'under_review', 'action_required', 'in_progress')),
  'open events equal the company''s open events (the dashboard''s and the monitoring list''s count)');

select results_eq(
  $$select lease_reference, verified, initial_monthly_rental, escalation_type::text, escalation_percentage, first_escalation_date,
           statement_id, period_start, rental_charged
    from public.reports_rental_comparisons('20000000-0000-4000-8000-000000000001') where verified$$,
  $$values ('MSQ-L001'::text, true, 12000.00::numeric, 'percentage'::text, 8.000::numeric, '2025-01-01'::date,
            '70000000-0000-4000-8000-000000000001'::uuid, '2026-09-01'::date, 12960.00::numeric)$$,
  'a monitored lease with its terms and its latest VERIFIED billed statement (the later one waits for review)');

-- Leases waiting for verification come back flagged, so the report can count them as excluded.
select results_eq(
  $$select lease_reference, lease_status::text, verified from public.reports_rental_comparisons('20000000-0000-4000-8000-000000000001')$$,
  $$values ('DVC-L003'::text, 'pending_verification'::text, false), ('MSQ-L001', 'active', true), ('WIP-L003', 'pending_verification', false)$$,
  'monitored leases and leases waiting for verification, by property and reference; ended leases are left out');

select results_eq(
  $$select enabled, (config ->> 'toleranceRands')::numeric from public.reports_discrepancy_rule('20000000-0000-4000-8000-000000000001')$$,
  $$values (true, 50::numeric)$$,
  'the company''s rental escalation discrepancy rule with its tolerance');

-- Company B's member sees B's lease and no rule (monitoring defaults apply).
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select results_eq(
  $$select lease_reference, rental_charged from public.reports_rental_comparisons('20000000-0000-4000-8000-000000000002')$$,
  $$values ('KGP-L001'::text, 15000.00::numeric)$$,
  'another company answers with its own leases only');
select is((select count(*)::int from public.reports_discrepancy_rule('20000000-0000-4000-8000-000000000002')), 0,
  'a company without the rule gets no row');

-- Another company is refused, not answered with nothing.
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok($$select * from public.reports_monitoring_events('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'events of another company are refused');
select throws_ok($$select * from public.reports_rental_comparisons('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'rental comparisons of another company are refused');
select throws_ok($$select * from public.reports_discrepancy_rule('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'the rule of another company is refused');

select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_monitoring_events('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

select * from finish();
rollback;
