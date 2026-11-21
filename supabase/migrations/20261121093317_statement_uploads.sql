-- Statement uploads (PRD module 6, ticket S-03): a writer uploads one or many statement PDFs as one upload batch.
--
-- Writers (company_admin, property_manager) held table-wide INSERT on statements, so a signed-in caller could insert a
-- statement that was already verified, with figures, a verifier or a duplicate link of their choosing, or with someone
-- else as the uploader. This migration narrows INSERT to what an upload records (same pattern as lease_documents):
--   * a signed-in caller inserts only the upload's own columns: status, figures, verifier, processing error, duplicate
--     link and delivery are never insertable, so a new statement is always `uploaded` with no figures (figures reach a
--     statement only through review and verification);
--   * the uploader and upload time are stamped from auth.uid() and now(), so they cannot be forged;
--   * audit: every registered statement is logged as an `upload` with its property, source system and upload batch.
-- The API checks that the file is in the statements bucket and computes its SHA-256 before inserting; the service role
-- (workers, tests, fixtures) is unaffected. UPDATE privileges are unchanged here.

-- --------------------------------------------------------------------------- privileges

revoke insert on public.statements from authenticated;
-- uploaded_by_user_id is insertable because it is NOT NULL, but private.guard_statement_upload overwrites it with auth.uid().
grant insert (
  id, company_id, property_id, tenant_id, unit_id, lease_id, file_name, storage_path, mime_type, size_bytes, file_sha256,
  source_system, statement_number, statement_date, period_start, period_end, upload_batch_id, uploaded_by_user_id
) on public.statements to authenticated;

alter table public.statements
  add constraint statements_upload_batch_id_check check (upload_batch_id is null or length(btrim(upload_batch_id)) between 1 and 100);

-- Following one upload batch on the statement list.
create index statements_upload_batch_idx on public.statements (company_id, upload_batch_id, uploaded_at desc)
  where upload_batch_id is not null;

-- --------------------------------------------------------------------------- guard

create function private.guard_statement_upload()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    -- BEFORE triggers run before Row Level Security's WITH CHECK on INSERT: a caller who cannot write the company is
    -- refused as RLS would.
    if not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
      raise exception 'new row violates row-level security policy for table "statements"' using errcode = '42501';
    end if;
    new.uploaded_by_user_id := (select auth.uid());
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_statement_upload() from public, anon, authenticated;

create trigger guard_upload before insert on public.statements
  for each row execute function private.guard_statement_upload();

-- --------------------------------------------------------------------------- audit

create function private.audit_statement_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property text;
begin
  select p.name into v_property from public.properties p where p.company_id = new.company_id and p.id = new.property_id;
  perform private.write_audit(
    new.company_id, 'upload', 'statement', new.id,
    format('Statement uploaded to %s: %s (%s)', coalesce(v_property, 'a property'), new.file_name, new.source_system),
    jsonb_build_array(
      private.field_change('propertyId', null::uuid, new.property_id),
      private.field_change('fileName', null::text, new.file_name),
      private.field_change('sourceSystem', null::text, new.source_system::text),
      private.field_change('fileSha256', null::text, new.file_sha256),
      private.field_change('uploadBatchId', null::text, new.upload_batch_id)
    )
  );
  return null;
end;
$$;
revoke all on function private.audit_statement_upload() from public, anon, authenticated;

create trigger audit_upload after insert on public.statements
  for each row execute function private.audit_statement_upload();
