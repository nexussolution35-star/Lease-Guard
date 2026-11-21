-- Dashboard arrears totals (20261122011000_dashboard_arrears_totals.sql): the outstanding balance on the latest verified
-- statement of each tenant's unit (the lease when no unit is named), totalled, the distinct tenants with a balance and
-- the statements waiting for review, with the rules of the domain ageArrears. Members only. (A verified statement always
-- names the lease's unit and its closing balance, so the lease and total-due fallbacks are covered by the domain tests.)
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(11);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- A verified statement of Nexus Solution's tenant at unit S01 under lease MSQ-L001, inserted as the owner.
create function tests.verified(p_id uuid, p_date date, p_closing numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_claims constant text := current_setting('request.jwt.claims', true);
begin
  -- Written as a background job would (no signed-in user), then the caller's claims are restored.
  perform set_config('request.jwt.claims', '', true);
  insert into public.statements (id, company_id, property_id, tenant_id, unit_id, lease_id, file_name, storage_path, mime_type,
    size_bytes, file_sha256, source_system, statement_date, period_start, period_end, status, uploaded_by_user_id, opening_balance,
    rental_charged, additional_charges, payments_received, closing_balance, total_due, verified_by_user_id, verified_at)
  values (p_id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'it.pdf', '20000000-0000-4000-8000-000000000001/' || p_id || '/it.pdf',
    'application/pdf', 1024, encode(extensions.digest(p_id::text, 'sha256'), 'hex'), 'MRI', p_date, date_trunc('month', p_date)::date,
    p_date, 'verified', '10000000-0000-4000-8000-000000000003', 0, greatest(p_closing, 0), 0, greatest(-p_closing, 0), p_closing,
    p_closing, '10000000-0000-4000-8000-000000000003', now());
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
create function tests.totals() returns text language sql as $$
  select row(t.total_outstanding, t.tenants_in_arrears, t.pending_review)::text
  from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000001') t
$$;
grant execute on function tests.totals() to authenticated;

select ok(has_function_privilege('authenticated', 'public.dashboard_arrears_totals(uuid)', 'EXECUTE'), 'members may call it');
select ok(not has_function_privilege('anon', 'public.dashboard_arrears_totals(uuid)', 'EXECUTE'), 'anonymous callers may not');

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;

-- The fixture: S01's latest verified statement (30 Sep) is paid up; the October one is still in review.
select is(tests.totals(), '(0,0,1)', 'a paid-up latest statement owes nothing; the statement in review is counted as waiting');

reset role;
select tests.verified('7a000000-0000-4000-8000-000000000001', '2026-08-31', 30000);
set local role authenticated;
select is(tests.totals(), '(0,0,1)', 'an older verified statement is superseded by the latest of the unit');

reset role;
select tests.verified('7a000000-0000-4000-8000-000000000002', '2026-11-15', 4000.25);
set local role authenticated;
select is(tests.totals(), '(4000.25,1,1)', 'the latest verified statement of the unit counts');

-- A balance in credit is not in arrears.
reset role;
select tests.verified('7a000000-0000-4000-8000-000000000005', '2026-11-18', -500);
set local role authenticated;
select is(tests.totals(), '(0,0,1)', 'a unit whose latest statement is in credit is not in arrears');

-- Two statements of the same date: the lowest id counts, as the Statements summary keeps the first.
reset role;
select tests.verified('7a000000-0000-4000-8000-000000000004', '2026-11-20', 200);
select tests.verified('7a000000-0000-4000-8000-000000000003', '2026-11-20', 100);
set local role authenticated;
select is(tests.totals(), '(100.00,1,1)', 'on the same date the statement with the lowest id counts');

-- The tenant's active payment arrangement (fixture) never takes the balance out: it is still owed.
select ok(exists (select 1 from public.payment_arrangements where tenant_id = '50000000-0000-4000-8000-000000000001' and status = 'active'),
  'the tenant is under an active payment arrangement');
select is(tests.totals(), '(100.00,1,1)', 'and is still in arrears on the dashboard');

-- Members of the company only.
select throws_ok($$select * from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of another company is refused rather than shown zeros');
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select is((select row(total_outstanding, tenants_in_arrears, pending_review)::text
  from public.dashboard_arrears_totals('20000000-0000-4000-8000-000000000002')), '(15000.00,1,0)',
  'a member of the other company sees its own figures only');

select * from finish();
rollback;
