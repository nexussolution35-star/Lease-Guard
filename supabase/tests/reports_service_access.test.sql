-- The reports service's database access (20261122020000_reports_service_access.sql, ADR 0003): the membership check
-- every reporting function starts with, and the conventions every reports_* object must keep (checked over the whole
-- schema, so a later reports migration that breaks one fails here): reporting functions are SECURITY INVOKER (Row
-- Level Security applies) and closed to anonymous callers, and reports_* tables have RLS on and grant nothing to anon.
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

-- Grants of the membership check.
select ok(has_function_privilege('authenticated', 'private.reports_require_member(uuid)', 'EXECUTE'),
  'signed-in callers may run the reports membership check');
select ok(not has_function_privilege('anon', 'private.reports_require_member(uuid)', 'EXECUTE'),
  'anonymous callers may not');

-- Conventions over every reports_* object (none may break them, now or in a later migration).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname like 'reports\_%' and p.prosecdef),
  0, 'every reports_* function is SECURITY INVOKER, so Row Level Security applies to what it reads');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'reports\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'no public reports_* function is executable by anonymous callers');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'reports\_%' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every reports_* table has Row Level Security enabled');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'reports\_%' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))),
  0, 'anonymous callers have no privilege on any reports_* table or view');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'reports\_%' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)),
  0, 'every reports_* view runs with the caller''s privileges (security_invoker), so Row Level Security applies');

-- The membership check itself.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select private.reports_require_member('20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a caller who is not signed in is refused');

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select lives_ok($$select private.reports_require_member('20000000-0000-4000-8000-000000000001')$$,
  'a member of the company (any role, read-only included) passes');
select throws_ok($$select private.reports_require_member('20000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member of another company is refused');
select throws_ok($$select private.reports_require_member(null)$$,
  '42501', null, 'no company is refused');

select * from finish();
rollback;
