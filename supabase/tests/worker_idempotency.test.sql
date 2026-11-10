-- Background-worker contracts: dedupe keys on monitoring outputs, job-run tracking columns and the
-- statement-processing columns (migrations 20261109100000..20261109100200).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(24);

create schema tests;
create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select p.id from public.properties p join public.companies c on c.id = p.company_id
    where c.initials = 'NS' order by p.id limit 1) as nexus_property,
  (select p.id from public.properties p join public.companies c on c.id = p.company_id
    where c.initials = 'KP' order by p.id limit 1) as kgalagadi_property,
  (select cu.user_id from public.company_users cu join public.companies c on c.id = cu.company_id
    where c.initials = 'NS' order by cu.user_id limit 1) as nexus_user,
  (select s.id from public.statements s join public.companies c on c.id = s.company_id
    where c.initials = 'NS' order by s.id limit 1) as nexus_statement,
  (select e.id from public.statement_extractions e join public.companies c on c.id = e.company_id
    where c.initials = 'NS' order by e.id limit 1) as nexus_extraction;

select ok((select num_nulls(variadic array[nexus, kgalagadi, nexus_property, kgalagadi_property, nexus_user,
  nexus_statement, nexus_extraction]) = 0 from tests.ids), 'every fixture exists');

-- Inserts one lease_expiry event for a company/property with the given dedupe key.
create function tests.add_event(p_company uuid, p_property uuid, p_key text) returns void
language sql as $$
  insert into public.monitoring_events
    (company_id, type, property_id, title, description, identified_on, priority, recommended_action, dedupe_key)
  values (p_company, 'lease_expiry', p_property, 'Worker test event', 'Raised by the worker test',
    '2026-11-09', 'high', 'Check the lease', p_key)
$$;
create function tests.events_with_key(p_key text) returns bigint
language sql as $$ select count(*) from public.monitoring_events where dedupe_key = p_key $$;

-- ------------------------------------------------------------------ monitoring_events.dedupe_key
select has_column('public', 'monitoring_events', 'dedupe_key', 'monitoring_events has a dedupe_key');
select col_is_null('public', 'monitoring_events', 'dedupe_key', 'monitoring_events.dedupe_key is nullable');
select lives_ok(
  $$select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), 'test:lease_expiry:a:90')$$,
  'an event with a dedupe key is inserted');
select throws_ok(
  $$select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), 'test:lease_expiry:a:90')$$,
  '23505', null, 'the same dedupe key cannot be inserted twice in one company');
select lives_ok(
  $$insert into public.monitoring_events
      (company_id, type, property_id, title, description, identified_on, priority, recommended_action, dedupe_key)
    values ((select nexus from tests.ids), 'lease_expiry', (select nexus_property from tests.ids), 'Again', 'Again',
      '2026-11-10', 'high', 'Check the lease', 'test:lease_expiry:a:90')
    on conflict (company_id, dedupe_key) do nothing$$,
  'a re-scan inserting the same key with ON CONFLICT DO NOTHING succeeds');
select is(tests.events_with_key('test:lease_expiry:a:90'), 1::bigint, 'and creates no duplicate event');
select lives_ok(
  $$select tests.add_event((select kgalagadi from tests.ids), (select kgalagadi_property from tests.ids), 'test:lease_expiry:a:90')$$,
  'the same key is independent per company');
select is(tests.events_with_key('test:lease_expiry:a:90'), 2::bigint, 'one event per company for the shared key');
select lives_ok(
  $$select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), null);
    select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), null)$$,
  'events without a dedupe key (manual events) never conflict');
select throws_ok(
  $$select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), 'has space')$$,
  '23514', null, 'a dedupe key may not contain whitespace');
select throws_ok(
  $$select tests.add_event((select nexus from tests.ids), (select nexus_property from tests.ids), '')$$,
  '23514', null, 'a dedupe key may not be empty');

-- ------------------------------------------------------------------ notifications.dedupe_key
select lives_ok(
  $$insert into public.notifications (company_id, user_id, type, severity, title, body, dedupe_key)
    values ((select nexus from tests.ids), (select nexus_user from tests.ids), 'monitoring_event', 'warning',
      'Test', 'Test', 'test:notify:1')$$,
  'a notification with a dedupe key is inserted');
select throws_ok(
  $$insert into public.notifications (company_id, user_id, type, severity, title, body, dedupe_key)
    values ((select nexus from tests.ids), (select nexus_user from tests.ids), 'monitoring_event', 'warning',
      'Test', 'Test', 'test:notify:1')$$,
  '23505', null, 'the same notification key cannot be inserted twice in one company');
select lives_ok(
  $$insert into public.notifications (company_id, user_id, type, severity, title, body)
    select (select nexus from tests.ids), (select nexus_user from tests.ids), 'system', 'info', 'Plain', 'Plain'
    from generate_series(1, 2)$$,
  'notifications without a dedupe key never conflict');

-- ------------------------------------------------------------------ job_runs
select col_is_null('public', 'job_runs', 'company_id', 'job_runs.company_id is nullable for system-level jobs');
select lives_ok(
  $$insert into public.job_runs (company_id, queue, job_name, queue_job_id, status, attempts, max_attempts, will_retry,
      started_at, finished_at, duration_ms)
    values (null, 'monitoring-dispatch', 'dispatch', 'repeat:test:1', 'succeeded', 1, 5, false, now(), now(), 12)$$,
  'a system-level dispatch run is recorded without a company');
select lives_ok(
  $$insert into public.job_runs (company_id, queue, job_name, queue_job_id, status, attempts, max_attempts, will_retry)
    values ((select nexus from tests.ids), 'lease-monitoring', 'scan', 'lease-monitoring.x.2026-11-09', 'skipped', 1, 5, false)$$,
  'a skipped duplicate run is recorded with status skipped');
select throws_ok(
  $$insert into public.job_runs (company_id, queue, job_name, status, attempts, will_retry)
    values ((select nexus from tests.ids), 'lease-monitoring', 'scan', 'succeeded', 1, true)$$,
  '23514', null, 'only a failed attempt can be marked for retry');
select throws_ok(
  $$insert into public.job_runs (company_id, queue, job_name, status, attempts, max_attempts)
    values ((select nexus from tests.ids), 'lease-monitoring', 'scan', 'failed', 1, 0)$$,
  '23514', null, 'max_attempts must be at least 1');
select throws_ok(
  $$insert into public.job_runs (company_id, queue, job_name, status, attempts, duration_ms)
    values ((select nexus from tests.ids), 'lease-monitoring', 'scan', 'failed', 1, -1)$$,
  '23514', null, 'duration cannot be negative');

-- ------------------------------------------------------------------ statement processing columns
select throws_ok(
  $$update public.statements set processing_error = '  ' where id = (select nexus_statement from tests.ids)$$,
  '23514', null, 'a processing error must not be blank');
select throws_ok(
  $$update public.statement_extractions set issues = '{}'::jsonb where id = (select nexus_extraction from tests.ids)$$,
  '23514', null, 'extraction issues must be a JSON array');
select is((select issues from public.statement_extractions where id = (select nexus_extraction from tests.ids)),
  '[]'::jsonb, 'existing extractions default to no issues');

select * from finish();
rollback;
