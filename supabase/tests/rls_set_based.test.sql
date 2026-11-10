-- Set-based RLS (migration 20261109101100_rls_set_based_membership) keeps exactly the old semantics.
--
-- For every company-owned table, companies, profiles and the two storage buckets, the rows each user
-- sees through RLS must equal the rows the original per-row helpers (is_company_member,
-- has_company_role, shares_company_with) allow, for every role, a member of two companies, a
-- member of the other company only and a suspended user. The policies must no longer call a helper
-- per row, and the plan must evaluate membership once (InitPlan).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(13);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- A suspended member (set as the database owner, like the backend would) and stored files in both
-- companies plus one without a company prefix.
update public.profiles set status = 'suspended' where email = 'zanele.khumalo@khumaloinvest.co.za';
insert into storage.objects (bucket_id, name)
select 'statements', c.id || '/' || gen_random_uuid() || '/statement.pdf' from public.companies c
union all
select 'lease-documents', c.id || '/' || gen_random_uuid() || '/lease.pdf' from public.companies c
union all
select 'statements', 'no-company-prefix/statement.pdf';

create function tests.company_tables() returns setof text
language sql stable set search_path = '' as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'company_id' and not a.attisdropped
    and c.relname <> 'job_runs'
  order by 1
$$;

-- Visible rows per table and company. With p_old_rules the original per-row helper predicates are
-- applied explicitly (run as the database owner, which bypasses RLS); without, RLS decides.
create function tests.visible(p_old_rules boolean) returns table (tbl text, company_id uuid, n bigint)
language plpgsql set search_path = '' as $$
declare
  t text;
  pred text;
begin
  for t in select * from tests.company_tables() loop
    pred := case
      when not p_old_rules then 'true'
      when t = 'audit_logs' then 'private.has_company_role(company_id, ''{company_admin,property_manager,read_only}'')'
      when t = 'notifications' then 'user_id = (select auth.uid()) and private.is_company_member(company_id)'
      when t = 'company_invitations' then 'private.has_company_role(company_id, ''{company_admin}'')'
      else 'private.is_company_member(company_id)'
    end;
    return query execute format(
      'select %L::text, company_id, count(*) from public.%I where %s group by company_id', t, t, pred);
  end loop;
  return query select 'companies'::text, c.id, 1::bigint from public.companies c
    where not p_old_rules or private.is_company_member(c.id);
  return query select 'profiles'::text, null::uuid, count(*) from public.profiles p
    where not p_old_rules or p.id = (select auth.uid()) or private.shares_company_with(p.id);
  return query select 'storage'::text, null::uuid, count(*) from storage.objects o
    where o.bucket_id in ('statements', 'lease-documents')
      and (not p_old_rules or private.is_company_member(private.storage_company_id(o.name)));
end;
$$;

create table tests.users (email text primary key);
insert into tests.users values
  ('thandi.mokoena@nexussolution.co.za'),   -- Nexus company_admin
  ('naledi.vdmerwe@nexussolution.co.za'),   -- Nexus property_manager
  ('sipho.dlamini@nexussolution.co.za'),    -- property_manager of both companies
  ('kabelo.molefe@nexussolution.co.za'),    -- Nexus read_only
  ('pieter@bothafamilytrust.co.za'),        -- Nexus property_owner
  ('lerato@kgalagadiproperty.co.za'),       -- Kgalagadi-only property_owner
  ('zanele.khumalo@khumaloinvest.co.za');   -- suspended Nexus property_owner

-- Expected visibility under the original rules, per user, computed as the database owner.
create table tests.expected (email text, tbl text, company_id uuid, n bigint);
do $$
declare
  u text;
begin
  for u in select email from tests.users loop
    perform set_config('request.jwt.claims', tests.claims(u), true);
    insert into tests.expected select u, v.* from tests.visible(true) v;
  end loop;
end;
$$;
grant select on tests.expected to authenticated;

-- Rows where RLS and the original rules disagree for the signed-in user (empty when equivalent).
create function tests.mismatches(p_email text) returns text[]
language sql set search_path = '' as $$
  select array_agg(coalesce(e.tbl, v.tbl) || ':' || coalesce(e.n, 0) || '<>' || coalesce(v.n, 0) order by 1)
  from (select tbl, company_id, n from tests.expected where email = p_email) e
  full join tests.visible(false) v on v.tbl = e.tbl and v.company_id is not distinct from e.company_id
  where e.n is distinct from v.n
$$;

select cmp_ok((select count(distinct tbl) from tests.expected where n > 0), '>=', 20::bigint,
  'the expected visibility covers the company tables, companies, profiles and storage');

set local role authenticated;
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select is(tests.mismatches('thandi.mokoena@nexussolution.co.za'), null, 'company_admin sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select is(tests.mismatches('naledi.vdmerwe@nexussolution.co.za'), null, 'property_manager sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select is(tests.mismatches('sipho.dlamini@nexussolution.co.za'), null, 'a member of two companies sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is(tests.mismatches('kabelo.molefe@nexussolution.co.za'), null, 'read_only sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select is(tests.mismatches('pieter@bothafamilytrust.co.za'), null, 'property_owner sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is(tests.mismatches('lerato@kgalagadiproperty.co.za'), null, 'a member of the other company only sees exactly what the old rules allowed');
select set_config('request.jwt.claims', tests.claims('zanele.khumalo@khumaloinvest.co.za'), true);
select is(tests.mismatches('zanele.khumalo@khumaloinvest.co.za'), null, 'a suspended user sees exactly what the old rules allowed');
select is((select count(*) from public.properties), 0::bigint, 'a suspended user sees no company rows');
reset role;

-- ------------------------------------------------------------------ policy shape and plan
select is(
  (select array_agg(schemaname || '.' || tablename || '.' || policyname order by 1)
   from pg_policies
   where schemaname in ('public', 'storage')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(is_company_member|has_company_role|can_write|shares_company_with)\('),
  null,
  'no policy calls a membership helper per row');

create function tests.plan(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain (costs off) ' || p_sql loop
    result := result || line || E'\n';
  end loop;
  return result;
end;
$$;
grant execute on function tests.plan(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select matches(tests.plan('select count(*) from public.audit_logs'), 'InitPlan',
  'the audit log policy evaluates the caller''s companies once (InitPlan)');
select doesnt_match(tests.plan('select count(*) from public.statement_extraction_fields'), 'is_company_member',
  'a company table is not filtered by a per-row membership call');
select matches(tests.plan('select count(*) from public.statement_extraction_fields'), 'InitPlan',
  'a company table policy evaluates the caller''s companies once (InitPlan)');
reset role;

select * from finish();
rollback;
