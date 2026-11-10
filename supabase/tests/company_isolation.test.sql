-- Company isolation through RLS, role-based write restrictions and cross-company foreign keys.
-- Self-contained: the two companies and every row are created by fixtures/two_companies.psql inside
-- this transaction and rolled back at the end. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(37);

-- ------------------------------------------------------------------ helpers (rolled back with the test)
create schema tests;
grant usage on schema tests to authenticated, anon;

-- JWT claims for a fixture user; SECURITY DEFINER so it works while impersonating.
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.uid(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email
$$;
create function tests.company(p_initials text) returns uuid
language sql security definer set search_path = '' as $$
  -- Fixture companies only (fixed ids), so rows other suites leave in a local database never match.
  select id from public.companies where initials = p_initials and id::text like '20000000-0000-4000-8000-%'
$$;

-- Every table with a company_id column (catalog-based, so a new table cannot be missed),
-- except the backend-only job_runs which authenticated users cannot query at all.
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

-- Rows the current role can see, per table and company. Runs with the caller's privileges and RLS.
create function tests.visible_counts() returns table (tbl text, company_id uuid, n bigint)
language plpgsql set search_path = '' as $$
declare
  t text;
begin
  for t in select * from tests.company_tables() loop
    return query execute format('select %L::text, company_id, count(*) from public.%I group by company_id', t, t);
  end loop;
  return query select 'companies'::text, c.id, 1::bigint from public.companies c;
end;
$$;

create table tests.expected as select * from tests.visible_counts();
grant select on tests.expected to authenticated;

-- ------------------------------------------------------------------ structural guarantees

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'RLS is enabled on every public table'
);
select is(
  (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  0::bigint,
  'anon has no privileges on any public table'
);
select is((select count(*) from tests.company_tables()), 34::bigint, 'all 34 end-user company-owned tables are covered');
select is(
  (select count(*) from (select tbl from tests.expected
                         where tbl <> 'companies' and n > 0 and company_id in (tests.company('NS'), tests.company('KP'))
                         group by tbl having count(distinct company_id) = 2) x),
  34::bigint,
  'the fixtures populate every company-owned table for both companies'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0::bigint,
  'authenticated has no TRUNCATE, REFERENCES or TRIGGER on any public table'
);
select is(
  (select count(*) from pg_default_acl d
   join pg_namespace n on n.oid = d.defaclnamespace,
   lateral aclexplode(d.defaclacl) a
   where pg_get_userbyid(d.defaclrole) = 'postgres' and n.nspname = 'public' and d.defaclobjtype in ('r', 'S')
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)),
  0::bigint,
  'new public tables and sequences grant nothing to anon or authenticated by default'
);

-- ------------------------------------------------------------------ anon sees nothing
set local role anon;
select throws_ok('select count(*) from public.properties', '42501', null, 'anon cannot read properties');
select throws_ok('select count(*) from public.tenants', '42501', null, 'anon cannot read tenants');
reset role;

-- ------------------------------------------------------------------ Nexus-only property manager
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select is(
  (select array_agg(distinct tbl order by tbl) from tests.visible_counts() where company_id <> tests.company('NS')),
  null,
  'Nexus member sees no row of another company in any table'
);
select is(
  (select array_agg(e.tbl order by e.tbl)
   from tests.expected e
   left join tests.visible_counts() v on v.tbl = e.tbl and v.company_id = e.company_id
   where e.company_id = tests.company('NS') and e.tbl not in ('notifications', 'company_invitations', 'whatsapp_onboarding_sessions')
     and v.n is distinct from e.n),
  null,
  'Nexus member sees every Nexus row in every table'
);
select is(
  (select count(*) from public.notifications where user_id <> tests.uid('naledi.vdmerwe@nexussolution.co.za')),
  0::bigint,
  'notifications are visible to their recipient only'
);
select throws_ok('select count(*) from public.job_runs', '42501', null, 'job_runs are not readable by end users');
select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name,
      contact_role, contact_phone, whatsapp_number, industry)
    values (tests.company('KP'), 'X (Pty) Ltd', 'X', 'pty_ltd', 'X', 'Owner', '+27820000000', '+27820000000', 'Retail')$$,
  '42501', null, 'a manager cannot write into a company they do not belong to'
);
update public.companies set contact_phone = '+27 11 000 0000' where id = tests.company('NS');
select throws_ok(
  $$insert into public.company_users (company_id, user_id, role)
    values (tests.company('NS'), tests.uid('lerato@kgalagadiproperty.co.za'), 'read_only')$$,
  '42501', null, 'a property manager cannot manage company memberships'
);

-- ------------------------------------------------------------------ Kgalagadi-only property owner
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is(
  (select coalesce(sum(n), 0) from tests.visible_counts() where company_id = tests.company('NS')),
  0::numeric,
  'Kgalagadi-only user sees zero Nexus rows'
);
select cmp_ok((select count(*) from public.properties), '>', 0::bigint, 'Kgalagadi-only user sees Kgalagadi properties');
select is((select count(*) from public.audit_logs), 0::bigint, 'property owners cannot read the audit log');

-- ------------------------------------------------------------------ manager shared by both companies
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select is((select count(*) from public.companies), 2::bigint, 'shared manager sees both companies');
select is(
  (select array_agg(e.tbl order by e.tbl)
   from tests.expected e
   left join tests.visible_counts() v on v.tbl = e.tbl and v.company_id = e.company_id
   where e.tbl not in ('notifications', 'company_invitations', 'whatsapp_onboarding_sessions') and e.company_id in (tests.company('NS'), tests.company('KP'))
     and v.n is distinct from e.n),
  null,
  'shared manager sees every row of both companies'
);
-- Composite foreign keys: a Nexus lease cannot use a Kgalagadi unit, even for a member of both.
select throws_ok(
  $$insert into public.leases (company_id, reference, property_id, unit_id, tenant_id, commencement_date,
      expiry_date, initial_monthly_rental, current_monthly_rental, payment_due_day, escalation_type,
      escalation_percentage, escalation_frequency, first_escalation_date)
    select tests.company('NS'), 'X-L999', u.property_id, u.id,
      (select id from public.tenants where company_id = tests.company('NS') limit 1),
      '2027-01-01', '2030-12-31', 1000, 1000, 1, 'percentage', 8, 'annual', '2028-01-01'
    from public.units u where u.company_id = tests.company('KP') limit 1$$,
  '23503', null, 'a lease cannot reference a unit from another company'
);
select throws_ok(
  $$update public.properties set company_id = tests.company('KP') where company_id = tests.company('NS')$$,
  '23514', null, 'a record cannot be moved to another company'
);

-- ------------------------------------------------------------------ read-only and owner roles cannot write
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$insert into public.properties (company_id, name, code, type, address_line1, suburb, city, province,
      postal_code, gross_lettable_area_sqm, manager_user_id, accounting_system)
    values (tests.company('NS'), 'X', 'XX', 'retail', 'X', 'X', 'X', 'Gauteng', '2000', 100,
      tests.uid('kabelo.molefe@nexussolution.co.za'), 'MRI')$$,
  '42501', null, 'read_only cannot insert'
);
update public.tenants set notes = 'changed by read_only';
delete from public.monitoring_events;

select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$insert into public.monitoring_rules (company_id, event_type, name, description, default_priority, config)
    values (tests.company('NS'), 'arrears', 'X', 'X', 'low', '{"kind":"arrears","minimumBalanceRands":1,"ageingBucketsDays":[30]}')$$,
  '42501', null, 'property_owner cannot insert'
);
update public.leases set current_monthly_rental = 1;

-- ------------------------------------------------------------------ company admin
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
update public.companies set contact_email = 'admin-updated@nexussolution.co.za' where id = tests.company('NS');
select throws_ok(
  $$insert into public.company_users (company_id, user_id, role)
    values (tests.company('KP'), tests.uid('kabelo.molefe@nexussolution.co.za'), 'read_only')$$,
  '42501', null, 'a company admin cannot add members to another company'
);
reset role;

-- Effects checked as the database owner.
select is((select count(*) from public.tenants where notes = 'changed by read_only'), 0::bigint, 'read_only update changed nothing');
select is(
  (select count(*) from public.monitoring_events),
  (select sum(n)::bigint from tests.expected where tbl = 'monitoring_events'),
  'read_only delete removed nothing'
);
select is((select count(*) from public.leases where current_monthly_rental = 1), 0::bigint, 'property_owner update changed nothing');
select is((select contact_phone from public.companies where initials = 'NS'), '+27 11 555 0100', 'a property manager cannot update company details');
select is((select contact_email from public.companies where initials = 'NS'), 'admin-updated@nexussolution.co.za', 'a company admin can update company details');

-- ------------------------------------------------------------------ storage: <company_id>/<entity_id>/<file>
select is(
  (select array_agg(id::text order by id) from storage.buckets where id in ('statements', 'lease-documents') and not public),
  array['lease-documents', 'statements'],
  'statement and lease document buckets exist and are private'
);
insert into storage.objects (bucket_id, name)
values ('statements', tests.company('KP') || '/' || gen_random_uuid() || '/kgalagadi-statement.pdf');

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('statements', tests.company('NS') || '/' || gen_random_uuid() || '/nexus.pdf')$$,
  'a Nexus manager can upload under the Nexus prefix'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('statements', tests.company('KP') || '/' || gen_random_uuid() || '/x.pdf')$$,
  '42501', null, 'a Nexus manager cannot upload under another company prefix'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('lease-documents', 'statements/no-company-prefix.pdf')$$,
  '42501', null, 'uploads without a company prefix are rejected'
);
select is(
  (select count(*) from storage.objects where name like tests.company('KP') || '/%'),
  0::bigint,
  'a Nexus manager cannot see another company''s files'
);

select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is(
  (select count(*) from storage.objects where name like tests.company('KP') || '/%'),
  1::bigint,
  'a Kgalagadi member can see Kgalagadi files'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('statements', tests.company('KP') || '/' || gen_random_uuid() || '/x.pdf')$$,
  '42501', null, 'a property owner cannot upload files'
);

set local role anon;
select is((select count(*) from storage.objects where bucket_id in ('statements', 'lease-documents')), 0::bigint, 'anon sees no stored files');
reset role;

select * from finish();
rollback;
