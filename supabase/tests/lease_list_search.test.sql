-- Lease list search by tenant (Module 5 / 03): the `tenant_search_text` computed field on leases.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(6);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- A lease row read as the database owner, so the function can be handed a lease the caller cannot see.
create function tests.lease(p_reference text) returns public.leases
language sql security definer set search_path = '' as $$
  select * from public.leases where reference = p_reference
$$;

select ok(not has_function_privilege('anon', 'public.tenant_search_text(public.leases)', 'execute'), 'anon cannot run the search field');
select ok(has_function_privilege('authenticated', 'public.tenant_search_text(public.leases)', 'execute'), 'signed-in users can');

-- ------------------------------------------------------------------ a read-only member of Nexus Solution
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;

select is(
  (select l.tenant_search_text from public.leases l where l.reference = 'MSQ-L001'),
  'Dlamini Cellular Dlamini Cellular (Pty) Ltd',
  'the field holds the tenant''s trading and legal names'
);
select results_eq(
  $$select l.reference from public.leases l where l.tenant_search_text ilike '%flame grill%' order by 1$$,
  $$values ('WIP-L003')$$,
  'a lease is found by its tenant''s name'
);
select is(
  (select count(*)::int from public.leases l where l.tenant_search_text ilike '%arcadia%'),
  0,
  'a tenant of another company is never matched'
);
select is(
  public.tenant_search_text(tests.lease('KGP-L001')),
  null,
  'handed another company''s lease, the field reveals no tenant name (Row Level Security on tenants)'
);

select * from finish();
rollback;
