-- Integrity of tenant message approvals (migration 20261109100500_message_approval_integrity).
-- Any writer may approve, including the requester, but only through an explicit decision: requests
-- are created pending, the approver is always the signed-in user, and an approval cannot be moved to
-- another message or have its approver rewritten. The service role (backend jobs) is not restricted.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(20);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Fixtures, captured as the database owner before impersonating.
create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from auth.users where email = 'sipho.dlamini@nexussolution.co.za') as sipho,
  (select id from auth.users where email = 'thandi.mokoena@nexussolution.co.za') as thandi;

-- Fresh outbound tenant messages awaiting approval, one per scenario.
create table tests.msgs (name text primary key, id uuid not null);
with tenant as (
  select t.company_id, t.id, t.whatsapp_number from public.tenants t
  where t.company_id = (select nexus from tests.ids) and t.whatsapp_number is not null
  order by t.id limit 1
), ins as (
  insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
    counterparty_number, company_number, body, status)
  select tenant.company_id, 'whatsapp', 'outbound', 'monthly_statement', 'tenant', tenant.id, tenant.whatsapp_number,
    '+27115550100', format('Good day. Your October 2026 statement is ready for you. (%s)', n), 'pending_approval'
  from tenant, unnest(array['own', 'colleague', 'withdrawn', 'service_role']) n
  returning id, body
)
insert into tests.msgs select substring(body from '\((.*)\)'), id from ins;
grant select on tests.ids, tests.msgs to authenticated, service_role;

select ok((select num_nulls(nexus, naledi, sipho, thandi) = 0 from tests.ids)
  and (select count(*) from tests.msgs) = 4, 'fixtures resolved');

-- ------------------------------------------------------------------ as a property manager (Naledi)
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
set constraints all immediate;

select throws_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
    select (select nexus from tests.ids), id, (select naledi from tests.ids), 'approved', (select naledi from tests.ids), now()
    from tests.msgs where name = 'own'$$,
  '42501', null, 'a writer cannot skip the decision by inserting an already approved request');
select throws_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
    select (select nexus from tests.ids), id, (select naledi from tests.ids), 'rejected', (select naledi from tests.ids), now()
    from tests.msgs where name = 'own'$$,
  '42501', null, 'a writer cannot insert an already decided request');
select throws_ok(
  $$update public.communications set status = 'approved' where id = (select id from tests.msgs where name = 'own')$$,
  '23514', null, 'a tenant message cannot be released without an approved approval');

select lives_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
    select (select nexus from tests.ids), id, (select naledi from tests.ids) from tests.msgs
    where name in ('own', 'colleague', 'withdrawn')$$,
  'a writer can request approval (pending)');

-- The requester may approve their own request; the approver is stamped from the signed-in user.
select lives_ok(
  $$update public.message_approvals set decision = 'approved', decided_by_user_id = (select thandi from tests.ids)
    where communication_id = (select id from tests.msgs where name = 'own')$$,
  'the requester can approve their own request');
select is(
  (select decided_by_user_id from public.message_approvals where communication_id = (select id from tests.msgs where name = 'own')),
  (select naledi from tests.ids), 'the approver is the signed-in user, not a name supplied by the caller');
select lives_ok(
  $$update public.communications set status = 'approved' where id = (select id from tests.msgs where name = 'own')$$,
  'the approved message can be released');

-- An approval granted for one message cannot be carried over to another, nor rewritten.
select throws_ok(
  $$update public.message_approvals set communication_id = (select id from tests.msgs where name = 'colleague')
    where communication_id = (select id from tests.msgs where name = 'own')$$,
  '42501', null, 'an approval cannot be moved to another message');
select throws_ok(
  $$update public.message_approvals set requested_by_user_id = (select sipho from tests.ids)
    where communication_id = (select id from tests.msgs where name = 'colleague')$$,
  '42501', null, 'a request cannot be handed to another requester');
select throws_ok(
  $$update public.message_approvals set decided_by_user_id = (select thandi from tests.ids)
    where communication_id = (select id from tests.msgs where name = 'own')$$,
  '42501', null, 'the recorded approver cannot be rewritten');
select throws_ok(
  $$update public.message_approvals set decided_at = now() - interval '1 day'
    where communication_id = (select id from tests.msgs where name = 'own')$$,
  '42501', null, 'the decision time cannot be rewritten');

-- The requester can also withdraw (reject) a request.
select lives_ok(
  $$update public.message_approvals set decision = 'rejected', reason = 'Withdrawn: wrong statement attached'
    where communication_id = (select id from tests.msgs where name = 'withdrawn')$$,
  'the requester can reject (withdraw) their own request');
select is(
  (select decided_by_user_id from public.message_approvals where communication_id = (select id from tests.msgs where name = 'withdrawn')),
  (select naledi from tests.ids), 'the rejection records the requester as decider');

-- ------------------------------------------------------------------ another property manager (Sipho) decides
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select lives_ok(
  $$update public.message_approvals set decision = 'approved'
    where communication_id = (select id from tests.msgs where name = 'colleague')$$,
  'another writer can approve the request');
select is(
  (select decided_by_user_id from public.message_approvals where communication_id = (select id from tests.msgs where name = 'colleague')),
  (select sipho from tests.ids), 'the approval records that writer as approver');
set constraints all deferred;

-- ------------------------------------------------------------------ the service role is not restricted
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
    select (select nexus from tests.ids), id, (select naledi from tests.ids) from tests.msgs where name = 'service_role'$$,
  'the service role can insert an approval request');
select lives_ok(
  $$update public.message_approvals set decision = 'approved', decided_by_user_id = (select naledi from tests.ids), decided_at = now()
    where communication_id = (select id from tests.msgs where name = 'service_role')$$,
  'the service role can record a decision');
select lives_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
    select (select nexus from tests.ids), id, (select naledi from tests.ids), 'rejected', (select naledi from tests.ids), now()
    from tests.msgs where name = 'service_role'$$,
  'the service role can insert an already decided approval (imports, platform tooling)');
select is(
  (select count(*) from public.message_approvals
   where communication_id = (select id from tests.msgs where name = 'service_role') and decision <> 'pending'),
  2::bigint, 'the service role wrote both decided approvals');
reset role;

select * from finish();
rollback;
