-- Stored file paths have exactly the shape `<company uuid>/<entity uuid>/<safe file name>`.
--
-- The CHECKs only required a path to start with `<company_id>/`, so 'A/../B/<id>/<file>.pdf' passed.
-- The service-role download builds the URL without encoding it and URL parsing collapses the '..'
-- segment, so a writer of company A could have the worker read company B's statement (into A's
-- extraction) or send B's PDF as a WhatsApp attachment.
--
-- The file-name rule is the API's (backend/src/infrastructure/storage/storage-paths.ts, FILE_SEGMENT,
-- produced by storageFileName): an ASCII letter or digit, then up to 119 of letters, digits, '.', '_'
-- and '-'. So there is no '/', '%', '\', whitespace, or '.'/'..' segment, and the company and entity
-- segments are lowercase canonical uuids (as private.storage_company_id accepts).

create function private.is_storage_object_path(p_path text, p_company_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path ~ ('^' || p_company_id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$')
$$;
-- Used by CHECK constraints, which are evaluated with the writer's privileges.
revoke all on function private.is_storage_object_path(text, uuid) from public;
grant execute on function private.is_storage_object_path(text, uuid) to authenticated, service_role;

alter table public.statements
  drop constraint statements_storage_path_check,
  add constraint statements_storage_path_check check (private.is_storage_object_path(storage_path, company_id));

alter table public.lease_documents
  drop constraint lease_documents_storage_path_check,
  add constraint lease_documents_storage_path_check check (private.is_storage_object_path(storage_path, company_id));

alter table public.communications
  drop constraint communications_attachment_check,
  add constraint communications_attachment_check check (
    (attachment_storage_path is null) = (attachment_file_name is null)
    and (attachment_storage_path is null) = (attachment_mime_type is null)
    and (attachment_storage_path is null or private.is_storage_object_path(attachment_storage_path, company_id))
  );
