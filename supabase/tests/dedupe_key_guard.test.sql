-- Dedupe keys are written by background jobs only (migration 20261109100400_guard_dedupe_keys).
-- A company writer may still create and update monitoring events, but never set or change a key.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(8);

create schema tests;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select p.id from public.properties p join public.companies c on c.id = p.company_id
    where c.initials = 'NS' order by p.id limit 1) as nexus_property;
grant usage on schema tests to authenticated;
grant select on tests.ids to authenticated;

-- A worker-created event with a key (the test runs as postgres here, like the service role).
insert into public.monitoring_events
  (company_id, type, property_id, title, description, identified_on, priority, recommended_action, dedupe_key)
select nexus, 'lease_expiry', nexus_property, 'Worker event', 'Raised by a job', '2026-11-09', 'high', 'Check', 'test:guard:worker'
from tests.ids;

select ok(exists (select 1 from public.monitoring_events where dedupe_key = 'test:guard:worker'),
  'background jobs (service role) can write dedupe keys');

-- ------------------------------------------------------------------ as a Nexus property manager
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok(
  $$insert into public.monitoring_events
      (company_id, type, property_id, title, description, identified_on, priority, recommended_action, dedupe_key)
    select nexus, 'lease_expiry', nexus_property, 'Pre-empt', 'x', '2026-11-09', 'high', 'x', 'test:guard:preempt'
    from tests.ids$$,
  '42501', null, 'a writer cannot create an event with a dedupe key');

select lives_ok(
  $$insert into public.monitoring_events
      (company_id, type, property_id, title, description, identified_on, priority, recommended_action)
    select nexus, 'lease_expiry', nexus_property, 'Manual event', 'Raised by a person', '2026-11-09', 'medium', 'Check'
    from tests.ids$$,
  'a writer can still create an event without a key');

select throws_ok(
  $$update public.monitoring_events set dedupe_key = 'test:guard:changed' where dedupe_key = 'test:guard:worker'$$,
  '42501', null, 'a writer cannot change an existing dedupe key');

select throws_ok(
  $$update public.monitoring_events set dedupe_key = null where dedupe_key = 'test:guard:worker'$$,
  '42501', null, 'a writer cannot clear a dedupe key (which would let the finding be raised again)');

select lives_ok(
  $$update public.monitoring_events set status = 'under_review' where dedupe_key = 'test:guard:worker'$$,
  'a writer can still move a keyed event through its workflow');

reset role;

select is((select status::text from public.monitoring_events where dedupe_key = 'test:guard:worker'), 'under_review',
  'the status change was applied and the key kept');
select ok(not exists (select 1 from public.monitoring_events where dedupe_key in ('test:guard:preempt', 'test:guard:changed')),
  'no user-supplied key was stored');

select * from finish();
rollback;
