-- Reports: lease expiry and renewal deadlines (20261122061300_reports_lease_dates.sql, ticket R-03): the two reporting
-- functions answer every member role of the company with its leases that have not ended (verified or not, with their
-- renewal option and open expiry and renewal events) and the thresholds monitoring applies, refuse another company and
-- anonymous callers, and never write.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(15);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Grants.
select ok(not has_function_privilege('anon', 'public.reports_lease_dates(uuid)', 'EXECUTE'), 'anon may not read lease dates');
select ok(not has_function_privilege('anon', 'public.reports_lease_date_settings(uuid)', 'EXECUTE'), 'anon may not read the lease date thresholds');
select is((select provolatile::text from pg_proc where proname = 'reports_lease_dates'), 's', 'lease dates are STABLE (read-only)');
select is((select provolatile::text from pg_proc where proname = 'reports_lease_date_settings'), 's', 'lease date thresholds are STABLE (read-only)');

set local role authenticated;

-- A read-only member of company A (Nexus Solution).
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select lease_reference, lease_status::text, verified, tenant_name, unit_number, expiry_date, current_monthly_rental, renewal_option_exists
    from public.reports_lease_dates('20000000-0000-4000-8000-000000000001')$$,
  $$values ('MSQ-L001'::text, 'active'::text, true, 'Dlamini Cellular'::text, 'S01'::text, '2028-12-31'::date, 12960.00::numeric, false),
           ('WIP-L003', 'pending_verification', false, 'Kasi Flame Grill', 'S02', '2030-02-28'::date, 9000.00::numeric, false),
           ('DVC-L003', 'pending_verification', false, 'Fresh Mart', 'S03', '2030-05-31'::date, 25000.00::numeric, false)$$,
  'every lease that has not ended, verified or not, soonest expiry first, with its tenant, unit, rental and renewal option');

select is(
  (select open_expiry_event_id from public.reports_lease_dates('20000000-0000-4000-8000-000000000001') where lease_reference = 'MSQ-L001'),
  (select id from public.monitoring_events where lease_reference = 'MSQ-L001' and type = 'lease_expiry'),
  'a lease carries its open lease-expiry event');
select is(
  (select open_renewal_event_id from public.reports_lease_dates('20000000-0000-4000-8000-000000000001') where lease_reference = 'MSQ-L001'),
  null,
  'and no renewal event when none is open');

select results_eq(
  $$select lease_expiry_notice_days, renewal_warning_days from public.reports_lease_date_settings('20000000-0000-4000-8000-000000000001')$$,
  $$values ('{180,90,30}'::integer[], '{90,60,30}'::integer[])$$,
  'thresholds: the lease-expiry rule''s days, and the company''s renewal warning days without a renewal rule');

-- Another company is refused, not answered with nothing.
select throws_ok($$select * from public.reports_lease_dates('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of company A cannot read company B''s leases');
select throws_ok($$select * from public.reports_lease_date_settings('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nor its thresholds');

-- A property owner of company B reads company B.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select results_eq(
  $$select lease_reference, verified from public.reports_lease_dates('20000000-0000-4000-8000-000000000002')$$,
  $$values ('KGP-L001'::text, true)$$,
  'a property owner of company B reads its leases');

-- A renewal option with its notice period, a resolved event, a lease that has ended and rules the company changed.
reset role;
select set_config('request.jwt.claims', '', true);
update public.leases set renewal_option_exists = true, renewal_term_months = 60, renewal_notice_period_months = 6
  where id = '60000000-0000-4000-8000-000000000001';
update public.monitoring_events set status = 'resolved', resolved_at = now(), resolved_by_user_id = '10000000-0000-4000-8000-000000000003', resolution_notes = 'Renewal agreed'
  where lease_reference = 'MSQ-L001' and type = 'lease_expiry';
update public.leases set status = 'terminated' where id = '60000000-0000-4000-8000-000000000002';
update public.monitoring_rules set enabled = false where company_id = '20000000-0000-4000-8000-000000000001' and event_type = 'lease_expiry';
insert into public.monitoring_rules (company_id, event_type, name, description, default_priority, config)
values ('20000000-0000-4000-8000-000000000001', 'renewal_notice_deadline', 'Renewal deadline', 'Renewal notice deadlines', 'high', '{"kind":"renewal_notice_deadline","warningDays":[45,15]}');
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);

select results_eq(
  $$select renewal_option_exists, renewal_exercised, renewal_notice_period_months, open_expiry_event_id
    from public.reports_lease_dates('20000000-0000-4000-8000-000000000001') where lease_reference = 'MSQ-L001'$$,
  $$values (true, false, 6, null::uuid)$$,
  'the renewal option and its notice period are returned; a resolved event is not open');
select is(
  (select count(*)::int from public.reports_lease_dates('20000000-0000-4000-8000-000000000001') where lease_reference = 'WIP-L003'),
  0,
  'a terminated lease is not returned');
select results_eq(
  $$select lease_expiry_notice_days, renewal_warning_days from public.reports_lease_date_settings('20000000-0000-4000-8000-000000000001')$$,
  $$values (null::integer[], '{45,15}'::integer[])$$,
  'a rule switched off has no thresholds; a renewal rule''s own days win over the company''s');

-- Not signed in.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.reports_lease_dates('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

select * from finish();
rollback;
