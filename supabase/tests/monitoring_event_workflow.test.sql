-- Monitoring event workflow (20261122010000_monitoring_event_status_workflow.sql): signed-in users hold no UPDATE on
-- monitoring_events, and status changes go only through public.update_monitoring_event_status, which allows exactly
-- the moves of EVENT_TRANSITIONS (@leaseguard/domain rules/monitoringWorkflow.ts), requires a reason to dismiss, and is
-- audited with the existing history. The service role (background jobs) keeps writing directly.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(38);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- An event row read as the database owner (independent of the caller's RLS).
create function tests.event(p_event_id uuid) returns public.monitoring_events
language sql security definer set search_path = '' as $$
  select * from public.monitoring_events where id = p_event_id
$$;
create function tests.history_count(p_event_id uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.audit_logs where entity_type = 'monitoring_event' and entity_id = p_event_id
$$;

-- Events of Nexus Solution, created as the owner: one per step of the walk below.
insert into public.monitoring_events (id, company_id, type, property_id, unit_id, tenant_id, lease_id, lease_reference, title, description,
  calculation, identified_on, priority, recommended_action, status)
select v.id, '20000000-0000-4000-8000-000000000001', 'lease_expiry', '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'MSQ-L001',
  v.title, 'Expiry approaching', '{"steps":["Expires 31 Dec 2028"]}', '2026-11-01', 'medium', 'Discuss renewal', 'new'
from (values
  ('e1000000-0000-4000-8000-000000000001'::uuid, 'Walk'),
  ('e1000000-0000-4000-8000-000000000002'::uuid, 'Dismiss'),
  ('e1000000-0000-4000-8000-000000000003'::uuid, 'Read only')
) as v (id, title);

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '20000000-0000-4000-8000-000000000002'::uuid as kgalagadi,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  'e1000000-0000-4000-8000-000000000001'::uuid as walk,
  'e1000000-0000-4000-8000-000000000002'::uuid as dismiss,
  'e1000000-0000-4000-8000-000000000003'::uuid as untouched,
  (select id from public.monitoring_events where company_id = '20000000-0000-4000-8000-000000000002' limit 1) as kgalagadi_event;
grant select on tests.ids to authenticated, service_role;

select ok((select num_nulls(nexus, kgalagadi, naledi, walk, dismiss, untouched, kgalagadi_event) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ privileges
select ok(not has_table_privilege('authenticated', 'public.monitoring_events', 'UPDATE'),
  'signed-in users hold no UPDATE on monitoring_events');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'monitoring_events'
     and has_column_privilege('authenticated', 'public.monitoring_events', column_name, 'UPDATE')),
  null, 'nor on any of its columns (status, calculation, description, the outcome columns or any other)');
select ok(has_table_privilege('authenticated', 'public.monitoring_events', 'SELECT'), 'members still read events');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'monitoring_events' and cmd = 'UPDATE'),
  'no update policy is left on monitoring_events');
select ok(has_function_privilege('authenticated', 'public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text)', 'EXECUTE'),
  'signed-in users may call update_monitoring_event_status');
select ok(not has_function_privilege('anon', 'public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text)', 'EXECUTE'),
  'anonymous callers may not');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text)'::regprocedure),
  'the function is SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.monitoring_event_transition_allowed(public.monitoring_event_status, public.monitoring_event_status)', 'EXECUTE'),
  'the transition rule is private');

-- ------------------------------------------------------------------ the transitions are EVENT_TRANSITIONS
select set_eq(
  $$select f::text, t::text from unnest(enum_range(null::public.monitoring_event_status)) f
      cross join unnest(enum_range(null::public.monitoring_event_status)) t
    where private.monitoring_event_transition_allowed(f, t)$$,
  $$values ('new', 'under_review'), ('new', 'dismissed'), ('under_review', 'action_required'), ('under_review', 'dismissed'),
      ('action_required', 'in_progress'), ('action_required', 'dismissed'), ('in_progress', 'resolved'), ('in_progress', 'dismissed')$$,
  'exactly the moves of the domain EVENT_TRANSITIONS are allowed (resolved and dismissed are final)');

-- ------------------------------------------------------------------ a property manager, through the Data API
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok($$update public.monitoring_events set status = 'under_review' where id = (select walk from tests.ids)$$,
  '42501', null, 'a property manager cannot change a status directly');
select throws_ok($$update public.monitoring_events set description = 'Rewritten', calculation = '{"steps":[]}' where id = (select walk from tests.ids)$$,
  '42501', null, 'nor rewrite the description or calculation');
select throws_ok($$update public.monitoring_events set dismissal_reason = null, resolution_notes = 'x' where id = (select walk from tests.ids)$$,
  '42501', null, 'nor wipe or write the outcome notes');

-- The workflow, forward: each move audited with the signed-in actor.
select is((select public.update_monitoring_event_status(nexus, walk, 'under_review', 'Picked up') from tests.ids),
  (select walk from tests.ids), 'new -> under review returns the event');
select is((tests.event(walk)).status::text, 'under_review', 'the move is applied') from tests.ids;
select is((tests.event(walk)).resolution_notes, 'Picked up', 'its note is the resolution notes') from tests.ids;
select throws_ok($$select public.update_monitoring_event_status(nexus, walk, 'resolved') from tests.ids$$,
  'P0001', 'An event cannot move from "under review" to "resolved".', 'a step cannot be skipped');
select throws_ok($$select public.update_monitoring_event_status(nexus, walk, 'new') from tests.ids$$,
  'P0001', null, 'an event never moves back to new');
select lives_ok($$select public.update_monitoring_event_status(nexus, walk, 'action_required') from tests.ids$$, 'under review -> action required');
select is((tests.event(walk)).resolution_notes, 'Picked up', 'a move without a note keeps the notes') from tests.ids;
select lives_ok($$select public.update_monitoring_event_status(nexus, walk, 'in_progress') from tests.ids$$, 'action required -> in progress');
select lives_ok($$select public.update_monitoring_event_status(nexus, walk, 'resolved', 'Corrected by the accountant') from tests.ids$$,
  'in progress -> resolved');
select ok((select (e).resolved_by_user_id = naledi and (e).resolved_at is not null from (select tests.event(walk) as e, naledi from tests.ids) x),
  'resolving stamps who and when');
select is((select tests.history_count(walk) from tests.ids), 4::bigint, 'every move wrote one history row');
select throws_ok($$select public.update_monitoring_event_status(nexus, walk, 'dismissed', 'Too late') from tests.ids$$,
  'P0001', null, 'a resolved event is final (cannot be dismissed)');
select throws_ok($$select public.update_monitoring_event_status(nexus, walk, 'in_progress') from tests.ids$$,
  'P0001', null, 'nor reopened');

-- Dismissing: the reason is required, recorded and audited; a dismissed event is final.
select throws_ok($$select public.update_monitoring_event_status(nexus, dismiss, 'dismissed') from tests.ids$$,
  '22023', 'Give the reason for dismissing the event.', 'dismissing requires a reason');
select throws_ok($$select public.update_monitoring_event_status(nexus, dismiss, 'dismissed', '   ') from tests.ids$$,
  '22023', null, 'a blank reason is no reason');
select throws_ok($$select public.update_monitoring_event_status(nexus, dismiss, 'dismissed', repeat('x', 2001)) from tests.ids$$,
  '22023', null, 'a note is at most 2000 characters');
select lives_ok($$select public.update_monitoring_event_status(nexus, dismiss, 'dismissed', ' Billed correctly under the addendum ') from tests.ids$$,
  'new -> dismissed with a reason');
select ok((select (e).dismissal_reason = 'Billed correctly under the addendum' and (e).dismissed_by_user_id = naledi
  from (select tests.event(dismiss) as e, naledi from tests.ids) x), 'the trimmed reason and who dismissed it are recorded');
select throws_ok($$select public.update_monitoring_event_status(nexus, dismiss, 'new') from tests.ids$$,
  'P0001', null, 'a dismissed event cannot be reopened');
select is((select tests.history_count(dismiss) from tests.ids), 1::bigint, 'the dismissal wrote one history row, the refusals none');

-- Another company's event, through either company id.
select throws_ok($$select public.update_monitoring_event_status(kgalagadi, kgalagadi_event, 'under_review') from tests.ids$$,
  '42501', null, 'a member of another company cannot change its events');
select throws_ok($$select public.update_monitoring_event_status(nexus, kgalagadi_event, 'under_review') from tests.ids$$,
  'P0002', null, 'nor reach them through their own company');

-- A read-only member.
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok($$select public.update_monitoring_event_status(nexus, untouched, 'under_review') from tests.ids$$,
  '42501', null, 'a read-only member cannot change an event');

-- ------------------------------------------------------------------ background jobs (service role)
reset role;
set local role service_role;
select lives_ok($$update public.monitoring_events set description = 'Re-raised by the job', calculation = '{"steps":["x"]}'
  where id = (select untouched from tests.ids)$$, 'the service role still writes events directly');
reset role;
select is((tests.event(untouched)).description, 'Re-raised by the job', 'and the write is applied') from tests.ids;

select * from finish();
rollback;
