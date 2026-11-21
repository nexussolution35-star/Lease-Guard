-- Monitoring event history (20261122003000_monitoring_event_status_history.sql): each status change writes one audit
-- row that carries the note given with it (resolution notes or the dismissal reason), with the signed-in actor.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(8);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Audit rows of one event, read as the database owner (independent of the caller's RLS). Every row of one transaction
-- has the same occurred_at, so a row is picked by the status it moved to, never by its position.
create function tests.history(p_event_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_type = 'monitoring_event' and entity_id = p_event_id
$$;
create function tests.move_to(p_event_id uuid, p_status text) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_type = 'monitoring_event' and entity_id = p_event_id
    and changes @> jsonb_build_array(jsonb_build_object('field', 'status', 'after', p_status))
$$;

create table tests.ids as select
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from public.monitoring_events where status = 'new' and company_id = (select id from public.companies where initials = 'NS') order by id limit 1) as first_event;
grant select on tests.ids to authenticated, service_role;

select ok((select num_nulls(naledi, first_event) = 0 from tests.ids), 'every fixture exists');

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

-- A move with a note records the note beside the status change.
update public.monitoring_events set status = 'under_review', resolution_notes = 'Asked the accountant for the ledger'
where id = (select first_event from tests.ids);
select is((select count(*) from tests.history((select first_event from tests.ids))), 1::bigint, 'one status change writes one history row');
select ok((select changes @> '[{"field":"status","before":"new","after":"under_review"},{"field":"resolution_notes","before":null,"after":"Asked the accountant for the ledger"}]'
  from tests.history((select first_event from tests.ids))), 'the history row carries the status change and the note');
select is((select actor_user_id from tests.history((select first_event from tests.ids))), (select naledi from tests.ids),
  'the history row names the signed-in user');

-- A move without a new note records the status alone.
update public.monitoring_events set status = 'action_required' where id = (select first_event from tests.ids);
select is((select jsonb_array_length(changes) from tests.move_to((select first_event from tests.ids), 'action_required')), 1,
  'a move that keeps the note records only the status');
select ok((select changes = '[{"field":"status","before":"under_review","after":"action_required"}]'::jsonb
  from tests.move_to((select first_event from tests.ids), 'action_required')), 'and that change is the status');

-- Dismissing records the reason.
update public.monitoring_events set status = 'dismissed', dismissal_reason = 'Billed correctly under the addendum'
where id = (select first_event from tests.ids);
select ok((select action = 'dismiss' and changes @> '[{"field":"dismissal_reason","before":null,"after":"Billed correctly under the addendum"}]'
  from tests.move_to((select first_event from tests.ids), 'dismissed')), 'a dismissal records its reason in the history');
select is((select summary from tests.move_to((select first_event from tests.ids), 'dismissed')) like '%Billed correctly under the addendum%', true,
  'the dismissal summary still names the reason');

select * from finish();
rollback;
