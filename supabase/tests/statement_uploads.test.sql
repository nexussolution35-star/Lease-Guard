-- Statement uploads (PRD module 6, ticket S-03): a signed-in writer inserts only an upload's own columns, the uploader
-- and time are stamped from auth.uid(), and every registered statement is audited as an upload.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(12);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, created_at, id
$$;
create function tests.statement(p_id uuid) returns public.statements
language sql security definer set search_path = '' as $$
  select * from public.statements where id = p_id
$$;
-- A statement row as the API registers it (uploaded_by_user_id is overwritten by the database for signed-in users).
create function tests.register(p_id uuid, p_sha text, p_uploader uuid, p_batch text default 'batch-1') returns void
language sql set search_path = '' as $$
  insert into public.statements (id, company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, uploaded_by_user_id, upload_batch_id)
  values (p_id, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'msq-2026-10.pdf',
      '20000000-0000-4000-8000-000000000001/' || p_id || '/msq-2026-10.pdf', 'application/pdf', 2048, p_sha, 'MRI', p_uploader, p_batch)
$$;
grant execute on function tests.register(uuid, text, uuid, text) to authenticated;

-- ------------------------------------------------------------------ a property manager registers an upload
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$select tests.register('73000000-0000-4000-8000-000000000001', repeat('a', 64), '10000000-0000-4000-8000-000000000001')$$,
  'a property manager registers an uploaded statement'
);
select is((tests.statement('73000000-0000-4000-8000-000000000001')).uploaded_by_user_id, '10000000-0000-4000-8000-000000000003'::uuid,
  'the uploader is the signed-in user, not the one the client sent');
select is((tests.statement('73000000-0000-4000-8000-000000000001')).status, 'uploaded'::public.statement_status,
  'a new upload is uploaded');
select is((select action::text || ' ' || entity_type::text || ' ' || summary from tests.audit('73000000-0000-4000-8000-000000000001')),
  'upload statement Statement uploaded to Maponya Square: msq-2026-10.pdf (MRI)', 'registering an upload is audited');
select is((select actor_user_id from tests.audit('73000000-0000-4000-8000-000000000001')), '10000000-0000-4000-8000-000000000003'::uuid,
  'by the signed-in user');
select is(
  (select c ->> 'after' from tests.audit('73000000-0000-4000-8000-000000000001') a, jsonb_array_elements(a.changes) c where c ->> 'field' = 'uploadBatchId'),
  'batch-1', 'the audit names the upload batch');

-- ------------------------------------------------------------------ an upload carries no review outcome
select throws_ok(
  $$insert into public.statements (company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, uploaded_by_user_id, status)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('b', 64), 'MRI',
      '10000000-0000-4000-8000-000000000003', 'verified')$$,
  '42501', null, 'a signed-in user cannot insert a statement with a status');
select throws_ok(
  $$insert into public.statements (company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, uploaded_by_user_id, closing_balance)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('b', 64), 'MRI',
      '10000000-0000-4000-8000-000000000003', 100)$$,
  '42501', null, 'a signed-in user cannot insert figures');
select throws_ok(
  $$insert into public.statements (company_id, property_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
      source_system, uploaded_by_user_id, uploaded_at)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x.pdf',
      '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf', 'application/pdf', 1, repeat('b', 64), 'MRI',
      '10000000-0000-4000-8000-000000000003', now() - interval '1 year')$$,
  '42501', null, 'a signed-in user cannot back-date an upload');
select throws_ok(
  $$select tests.register('73000000-0000-4000-8000-000000000002', repeat('a', 64), '10000000-0000-4000-8000-000000000003')$$,
  '23505', null, 'the identical file is refused while the first is live');

-- ------------------------------------------------------------------ members who only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select tests.register('73000000-0000-4000-8000-000000000003', repeat('c', 64), '10000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'a read-only member cannot register a statement'
);
reset role;

select is((select count(*) from public.audit_logs where entity_id = '73000000-0000-4000-8000-000000000003'), 0::bigint,
  'a refused upload leaves no audit entry');

select * from finish();
rollback;
