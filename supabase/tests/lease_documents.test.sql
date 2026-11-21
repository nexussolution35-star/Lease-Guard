-- Lease documents (PRD module 5, ticket M5-02): PDF only within 20 MB, company-scoped storage path, uploader stamped
-- from auth.uid(), the file must be in the bucket, recorded documents and their files are kept, audit.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(19);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Rows read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, created_at, id
$$;
create function tests.document(p_id uuid) returns public.lease_documents
language sql security definer set search_path = '' as $$
  select * from public.lease_documents where id = p_id
$$;
-- Storage objects the caller's update changed (RLS filters rows silently, so the count shows the policy).
create function tests.touch_object(p_bucket text, p_name text) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  update storage.objects set metadata = coalesce(metadata, '{}'::jsonb) || '{"touched": true}' where bucket_id = p_bucket and name = p_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function tests.touch_object(text, text) to authenticated;

-- Nexus (NS) company, its lease MSQ-L001, and the documents' ids and paths.
create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '60000000-0000-4000-8000-000000000001'::uuid as lease,
  '10000000-0000-4000-8000-000000000001'::uuid as thandi,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '62000000-0000-4000-8000-000000000001'::uuid as signed,
  '62000000-0000-4000-8000-000000000002'::uuid as missing,
  '62000000-0000-4000-8000-000000000003'::uuid as image,
  '62000000-0000-4000-8000-000000000004'::uuid as large,
  '62000000-0000-4000-8000-000000000005'::uuid as statement_file;
grant select on tests.ids to authenticated, service_role;

create function tests.path(p_id uuid, p_file text) returns text
language sql set search_path = '' as $$ select '20000000-0000-4000-8000-000000000001/' || p_id || '/' || p_file $$;
grant execute on function tests.path(uuid, text) to authenticated;

-- A document row as the API inserts it (uploaded_by_user_id is overwritten by the database for signed-in users).
create function tests.insert_document(p_id uuid, p_path text, p_mime text, p_size bigint, p_uploader uuid) returns void
language sql set search_path = '' as $$
  insert into public.lease_documents (id, company_id, lease_id, document_type, title, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by_user_id)
  values (p_id, '20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'signed_lease', 'Signed lease 2026',
          'signed.pdf', p_path, p_mime, p_size, repeat('c', 64), p_uploader)
$$;
grant execute on function tests.insert_document(uuid, text, text, bigint, uuid) to authenticated;

-- Files already in the buckets (as the API's signed upload would leave them), written as the database owner.
insert into storage.objects (bucket_id, name) values
  ('lease-documents', tests.path('62000000-0000-4000-8000-000000000003', 'scan.png')),
  ('lease-documents', tests.path('62000000-0000-4000-8000-000000000004', 'huge.pdf')),
  ('statements', tests.path('62000000-0000-4000-8000-000000000005', 'statement.pdf'));

select is((select allowed_mime_types from storage.buckets where id = 'lease-documents'), array['application/pdf'],
  'the lease-documents bucket accepts PDFs only');
select is((select file_size_limit from storage.buckets where id = 'lease-documents'), 20971520::bigint,
  'the lease-documents bucket accepts at most 20 MB');

-- ------------------------------------------------------------------ a property manager uploads and records a document
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('lease-documents', tests.path((select signed from tests.ids), 'signed.pdf'))$$,
  'a property manager uploads a file under the company prefix'
);
select lives_ok(
  $$select tests.insert_document((select signed from tests.ids), tests.path((select signed from tests.ids), 'signed.pdf'), 'application/pdf', 2048, (select thandi from tests.ids))$$,
  'a property manager records the uploaded file on the lease'
);
select is((tests.document((select signed from tests.ids))).uploaded_by_user_id, (select naledi from tests.ids),
  'the uploader is the signed-in user, not the one the client sent');
select is((select action::text || ' ' || entity_type::text || ' ' || summary from tests.audit((select signed from tests.ids))),
  'upload lease_document Signed Lease uploaded to lease MSQ-L001: Signed lease 2026', 'recording a document is audited');
select is((select actor_user_id from tests.audit((select signed from tests.ids))), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$select tests.insert_document((select missing from tests.ids), tests.path((select missing from tests.ids), 'gone.pdf'), 'application/pdf', 2048, (select naledi from tests.ids))$$,
  'P0001', 'Upload the file before recording the document', 'a file that is not in the bucket cannot be recorded'
);
select throws_ok(
  $$select tests.insert_document((select image from tests.ids), tests.path((select image from tests.ids), 'scan.png'), 'image/png', 2048, (select naledi from tests.ids))$$,
  '23514', null, 'a lease document is a PDF'
);
select throws_ok(
  $$select tests.insert_document((select large from tests.ids), tests.path((select large from tests.ids), 'huge.pdf'), 'application/pdf', 20971521, (select naledi from tests.ids))$$,
  '23514', null, 'a lease document is at most 20 MB'
);
select throws_ok(
  $$select tests.insert_document((select missing from tests.ids), tests.path((select signed from tests.ids), 'signed.pdf'), 'application/pdf', 2048, (select naledi from tests.ids))$$,
  '23514', null, 'the storage path is the document''s own folder'
);

-- ------------------------------------------------------------------ a recorded document and its file are kept
select throws_ok(
  $$update public.lease_documents set title = 'Changed' where id = (select signed from tests.ids)$$,
  '42501', null, 'a recorded document is not changed by a signed-in user'
);
select throws_ok(
  $$delete from public.lease_documents where id = (select signed from tests.ids)$$,
  '42501', null, 'a recorded document is not deleted by a signed-in user'
);
select is(tests.touch_object('lease-documents', tests.path((select signed from tests.ids), 'signed.pdf')), 0,
  'a lease document''s file is not replaced by a signed-in user');
select is(tests.touch_object('statements', tests.path((select statement_file from tests.ids), 'statement.pdf')), 1,
  'a statement file still is (writers keep update on the statements bucket)');
select is((select count(*) from storage.objects where bucket_id = 'lease-documents' and name like '20000000-0000-4000-8000-000000000001/%'),
  3::bigint, 'members read their company''s lease document files');

-- ------------------------------------------------------------------ members who only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('lease-documents', tests.path(gen_random_uuid(), 'x.pdf'))$$,
  '42501', null, 'a read-only member cannot upload a lease document file'
);
select throws_ok(
  $$select tests.insert_document((select missing from tests.ids), tests.path((select missing from tests.ids), 'x.pdf'), 'application/pdf', 2048, (select naledi from tests.ids))$$,
  '42501', null, 'a read-only member cannot record a lease document'
);
select is((select count(*) from public.lease_documents where lease_id = (select lease from tests.ids)), 2::bigint,
  'a read-only member lists the lease''s documents');

select * from finish();
rollback;
