-- Private storage buckets for statement and lease document files.
--
-- Object path convention (both buckets):   <company_id>/<entity_id>/<file name>
--   statements:       <company_id>/<statement_id>/<file name>
--   lease-documents:  <company_id>/<lease_document_id>/<file name>
-- The first path segment decides access: members of that company read, company_admin and
-- property_manager upload, replace and delete. The matching table rows (statements.storage_path,
-- lease_documents.storage_path, communications.attachment_storage_path) hold the same path and are
-- CHECK-constrained to start with their company_id.
-- The 20 MB limit matches DOCUMENT_PROCESSING_MAX_FILE_MB in .env.example.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('statements', 'statements', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg']),
  ('lease-documents', 'lease-documents', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Company id from the first path segment; NULL when the segment is not a uuid (denies access).
create function private.storage_company_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;
grant execute on function private.storage_company_id(text) to authenticated, service_role;

create policy leaseguard_members_read on storage.objects for select to authenticated
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.is_company_member(private.storage_company_id(name))
  );
create policy leaseguard_writers_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('statements', 'lease-documents')
    and private.can_write(private.storage_company_id(name))
  );
create policy leaseguard_writers_update on storage.objects for update to authenticated
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.can_write(private.storage_company_id(name))
  )
  with check (
    bucket_id in ('statements', 'lease-documents')
    and private.can_write(private.storage_company_id(name))
  );
create policy leaseguard_writers_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.can_write(private.storage_company_id(name))
  );
