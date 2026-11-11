-- Company configuration and membership management reach the audit log.
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
-- Audit rows read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid, p_action public.audit_action) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id and action = p_action
$$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from auth.users where email = 'thandi.mokoena@nexussolution.co.za') as thandi,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from auth.users where email = 'kabelo.molefe@nexussolution.co.za') as kabelo;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, thandi, naledi, kabelo) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ company admin: company details
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;

update public.companies set vat_number = '4123456789', city = 'Sandton' where id = (select nexus from tests.ids);
select is((select count(*) from tests.audit((select nexus from tests.ids), 'update') where summary = 'Company details updated'), 1::bigint,
  'changing company details writes one audit row');
select is((select actor_user_id from tests.audit((select nexus from tests.ids), 'update') where summary = 'Company details updated'),
  (select thandi from tests.ids), 'the actor is the signed-in admin');
select is((select jsonb_agg(c ->> 'field' order by c ->> 'field') from tests.audit((select nexus from tests.ids), 'update') a,
  jsonb_array_elements(a.changes) c where a.summary = 'Company details updated'), '["city", "vat_number"]'::jsonb,
  'only the changed columns are recorded');
select is((select c ->> 'after' from tests.audit((select nexus from tests.ids), 'update') a, jsonb_array_elements(a.changes) c
  where a.summary = 'Company details updated' and c ->> 'field' = 'vat_number'), '4123456789', 'with the new value');

-- ------------------------------------------------------------------ company admin: monitoring settings
update public.companies set lease_expiry_notice_days = '{365,180,90}', owner_summary_weekday = 'friday' where id = (select nexus from tests.ids);
select is((select count(*) from tests.audit((select nexus from tests.ids), 'update') where summary = 'Notice periods and reminder timing updated'), 1::bigint,
  'changing only settings is recorded as a settings change');
select is((select c ->> 'after' from tests.audit((select nexus from tests.ids), 'update') a, jsonb_array_elements(a.changes) c
  where a.summary = 'Notice periods and reminder timing updated' and c ->> 'field' = 'lease_expiry_notice_days'), '365, 180, 90',
  'notice days are recorded as a readable scalar');

update public.companies set vat_number = '4123456789' where id = (select nexus from tests.ids);
select is((select count(*) from tests.audit((select nexus from tests.ids), 'update') where entity_type = 'company' and summary like '%updated'), 2::bigint,
  'an update that changes nothing writes no audit row');

-- ------------------------------------------------------------------ company admin: membership
update public.company_users set role = 'property_manager'
  where company_id = (select nexus from tests.ids) and user_id = (select kabelo from tests.ids);
select is((select summary from tests.audit((select kabelo from tests.ids), 'update') where entity_type = 'user'),
  'Changed the role of Kabelo Molefe from read only to property manager', 'a role change is audited by name');
select is((select company_id from tests.audit((select kabelo from tests.ids), 'update') where entity_type = 'user'),
  (select nexus from tests.ids), 'in the company it happened in');

delete from public.company_users where company_id = (select nexus from tests.ids) and user_id = (select kabelo from tests.ids);
select is((select summary from tests.audit((select kabelo from tests.ids), 'delete')), 'Removed Kabelo Molefe from the workspace',
  'removing a member is audited');
select is((select actor_user_id from tests.audit((select kabelo from tests.ids), 'delete')), (select thandi from tests.ids),
  'by the admin who removed them');

-- ------------------------------------------------------------------ other members cannot, and nothing is recorded
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
update public.companies set name = 'Renamed by a manager' where id = (select nexus from tests.ids);
select is((select count(*) from tests.audit((select nexus from tests.ids), 'update') where entity_type = 'company' and summary like '%updated'), 2::bigint,
  'a property manager changes nothing, so nothing is audited');

-- The other company's audit log is untouched, and the audit rows are only visible within the company.
reset role;
select is((select count(*) from public.audit_logs where company_id = (select kgalagadi from tests.ids)
  and (summary like '%updated' or summary like 'Changed the role of%' or summary like 'Removed %')), 0::bigint,
  'nothing was recorded in the other company');

-- ------------------------------------------------------------------ cascades are not audited
select set_config('request.jwt.claims', '', true);
insert into public.company_users (company_id, user_id, role, is_default)
  values ((select kgalagadi from tests.ids), (select kabelo from tests.ids), 'read_only', false);
delete from public.company_users where company_id = (select kgalagadi from tests.ids) and user_id = (select kabelo from tests.ids);
select is((select count(*) from tests.audit((select kabelo from tests.ids), 'delete') where company_id = (select kgalagadi from tests.ids)), 0::bigint,
  'a membership removed without a signed-in user (cleanup, cascade) is not audited');

select * from finish();
rollback;
