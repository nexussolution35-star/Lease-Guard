-- Lease documents (PRD module 5, ticket M5-02): upload, record and download the documents of a lease (signed lease,
-- addendum, renewal agreement, bank guarantee, deposit receipt, FICA, other).
--
-- Writers (company_admin, property_manager) already held table-wide INSERT, UPDATE and DELETE on lease_documents and
-- could replace or delete objects in the lease-documents bucket. This migration narrows that to what the product allows:
--   * a lease document is a PDF of at most 20 MB, stored at <company_id>/<this document's id>/<safe file name> in the
--     private lease-documents bucket (now PDF only);
--   * a recorded document is kept: signed-in users insert it and never change or delete it, and the stored file is never
--     replaced or removed by a signed-in user (the statements bucket keeps its update and delete policies);
--   * the uploader and time are stamped from auth.uid(), so they cannot be forged; a signed-in caller records only a
--     file that is in the bucket;
--   * audit: every recorded document is logged as an `upload` with the lease reference.

-- --------------------------------------------------------------------------- table rules

-- Existing rows (none are written by the API before this ticket) are PDFs in practice; images are no longer accepted.
alter table public.lease_documents
  add constraint lease_documents_pdf_only check (mime_type = 'application/pdf'),
  add constraint lease_documents_size_limit check (size_bytes <= 20971520),
  add constraint lease_documents_storage_path_id check (split_part(storage_path, '/', 2) = id::text),
  add constraint lease_documents_title_check check (length(btrim(title)) between 1 and 200),
  add constraint lease_documents_file_name_check check (length(btrim(file_name)) between 1 and 255);

-- Newest first per lease, as the lease detail lists them.
create index lease_documents_lease_uploaded_idx on public.lease_documents (company_id, lease_id, uploaded_at desc);

-- --------------------------------------------------------------------------- privileges

revoke insert, update, delete on public.lease_documents from authenticated;
-- uploaded_by_user_id is insertable because it is NOT NULL, but private.guard_lease_document overwrites it with auth.uid().
grant insert (
  id, company_id, lease_id, document_type, title, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by_user_id
) on public.lease_documents to authenticated;
drop policy writers_update on public.lease_documents;
drop policy writers_delete on public.lease_documents;

-- --------------------------------------------------------------------------- guard

create function private.guard_lease_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    -- BEFORE triggers run before Row Level Security's WITH CHECK on INSERT: a caller who cannot write the company is
    -- refused as RLS would, before the bucket is looked at.
    if not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
      raise exception 'new row violates row-level security policy for table "lease_documents"' using errcode = '42501';
    end if;
    new.uploaded_by_user_id := (select auth.uid());
    new.uploaded_at := now();
    -- Read through the caller's storage policies: only a file of the caller's company that is in the bucket.
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'lease-documents' and o.name = new.storage_path
    ) then
      raise exception 'Upload the file before recording the document' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_lease_document() from public, anon, authenticated;

create trigger guard_insert before insert on public.lease_documents
  for each row execute function private.guard_lease_document();

-- --------------------------------------------------------------------------- audit

create function private.audit_lease_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  select l.reference into v_reference from public.leases l where l.company_id = new.company_id and l.id = new.lease_id;
  perform private.write_audit(
    new.company_id, 'upload', 'lease_document', new.id,
    format('%s uploaded to lease %s: %s', initcap(replace(new.document_type::text, '_', ' ')), v_reference, new.title),
    jsonb_build_array(
      private.field_change('leaseId', null::uuid, new.lease_id),
      private.field_change('documentType', null::text, new.document_type::text),
      private.field_change('title', null::text, new.title),
      private.field_change('fileName', null::text, new.file_name)
    )
  );
  return null;
end;
$$;
revoke all on function private.audit_lease_document() from public, anon, authenticated;

create trigger audit_change after insert on public.lease_documents
  for each row execute function private.audit_lease_document();

-- --------------------------------------------------------------------------- storage: lease-documents bucket

update storage.buckets
set allowed_mime_types = array['application/pdf'], file_size_limit = 20971520
where id = 'lease-documents';

-- Members still read and writers still upload both buckets (leaseguard_members_read, leaseguard_writers_insert).
-- Only statement files may be replaced or removed; a lease document's file stays as recorded.
alter policy leaseguard_writers_update on storage.objects
  using (
    bucket_id = 'statements'
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  )
  with check (
    bucket_id = 'statements'
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
alter policy leaseguard_writers_delete on storage.objects
  using (
    bucket_id = 'statements'
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
