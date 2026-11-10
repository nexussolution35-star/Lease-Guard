-- Colleague profiles are visible only to active members
-- (migration 20261109100600_shares_company_with_active_caller).
-- An invited, suspended or deactivated user still sees their own profile, but no colleague's.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(8);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Nexus colleagues in every status (set as the database owner, like the backend would).
update public.profiles set status = 'suspended' where email = 'kabelo.molefe@nexussolution.co.za';
update public.profiles set status = 'invited' where email = 'pieter@bothafamilytrust.co.za';
update public.profiles set status = 'deactivated' where email = 'zanele.khumalo@khumaloinvest.co.za';

-- Everyone who shares a company with Naledi, herself included, counted as the database owner.
create table tests.expected as select count(distinct theirs.user_id) as naledi_colleagues
from public.company_users mine
join public.company_users theirs on theirs.company_id = mine.company_id
where mine.user_id = (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za');
grant select on tests.expected to authenticated;

select cmp_ok((select naledi_colleagues from tests.expected), '>', 1::bigint, 'Naledi has colleagues');

-- ------------------------------------------------------------------ an active member
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.profiles), (select naledi_colleagues from tests.expected),
  'an active member sees every colleague''s profile');
select ok(exists (select 1 from public.profiles where email = 'kabelo.molefe@nexussolution.co.za'),
  'an active member still sees a suspended colleague');

-- ------------------------------------------------------------------ inactive users see only themselves
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.profiles), 1::bigint, 'a suspended user sees one profile');
select is((select email from public.profiles), 'kabelo.molefe@nexussolution.co.za', 'a suspended user sees only their own profile');

select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select is((select count(*) from public.profiles), 1::bigint, 'an invited user sees one profile');
select is((select email from public.profiles), 'pieter@bothafamilytrust.co.za', 'an invited user sees only their own profile');

select set_config('request.jwt.claims', tests.claims('zanele.khumalo@khumaloinvest.co.za'), true);
select is((select count(*) from public.profiles), 1::bigint, 'a deactivated user sees only their own profile');
reset role;

select * from finish();
rollback;
