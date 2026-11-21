-- Portfolio import, ticket I-01 (upload a portfolio file): a company admin or property manager uploads a CSV or XLSX
-- file exported from their own system, to add properties with their units or units of one property. The API parses
-- the file and stores it as an import batch with its rows; nothing is written to properties or units yet.
--
--   * portfolio_imports: one row per uploaded file (the batch): scope, file details, the worksheet read (XLSX) or the
--     separator detected (CSV), the column headings, the row count, and who uploaded it and when (stamped from
--     auth.uid(), never a value the client sent);
--   * portfolio_import_rows: the batch's data rows, cells in column order, empty rows not stored;
--   * create_portfolio_import / replace_portfolio_import_sheet: the batch and its rows are written in one
--     transaction (SECURITY INVOKER: RLS, grants and triggers apply as to a direct write);
--   * the private portfolio-imports bucket keeps the original file at <company_id>/<import_id>/<file name>;
--   * audit: a new batch ('upload') and a change of worksheet ('update') are recorded.

-- --------------------------------------------------------------------------- audit entity type

alter type public.entity_type add value if not exists 'portfolio_import';

-- --------------------------------------------------------------------------- tables

create table public.portfolio_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scope text not null check (scope in ('properties', 'units')),
  property_id uuid,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  -- <company_id>/<this import's id>/<safe file name> in the 'portfolio-imports' bucket.
  storage_path text not null unique check (
    private.is_storage_object_path(storage_path, company_id) and split_part(storage_path, '/', 2) = id::text
  ),
  file_format text not null check (file_format in ('csv', 'xlsx')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_name text check (sheet_name is null or length(sheet_name) between 1 and 31),
  sheet_names text[] not null default '{}',
  delimiter text check (delimiter in (',', ';')),
  columns text[] not null check (cardinality(columns) between 1 and 100),
  row_count integer not null check (row_count between 1 and 5000),
  uploaded_by_user_id uuid,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_imports_company_id_key unique (company_id, id),
  constraint portfolio_imports_scope_property_check check ((scope = 'units') = (property_id is not null)),
  constraint portfolio_imports_format_check check (
    case file_format
      when 'csv' then delimiter is not null and sheet_name is null and cardinality(sheet_names) = 0
      else delimiter is null and sheet_name is not null and sheet_name = any (sheet_names)
    end
  ),
  constraint portfolio_imports_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id) on delete cascade,
  constraint portfolio_imports_uploaded_by_fk foreign key (company_id, uploaded_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (uploaded_by_user_id)
);
create index portfolio_imports_company_uploaded_idx on public.portfolio_imports (company_id, uploaded_at desc);
create index portfolio_imports_property_idx on public.portfolio_imports (company_id, property_id) where property_id is not null;
create index portfolio_imports_uploaded_by_idx on public.portfolio_imports (company_id, uploaded_by_user_id) where uploaded_by_user_id is not null;
create index portfolio_imports_sha256_idx on public.portfolio_imports (company_id, file_sha256);
comment on table public.portfolio_imports is
  'An uploaded portfolio file (CSV or XLSX) accepted as an import batch; the original is in the portfolio-imports bucket. Members read; company admins and property managers upload.';

create table public.portfolio_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  import_id uuid not null,
  -- The row's number in the file or worksheet (1 is the first row), so a person can find it in their own system.
  row_number integer not null check (row_number >= 1),
  -- One string per column of the batch, in column order.
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  created_at timestamptz not null default now(),
  constraint portfolio_import_rows_import_fk foreign key (company_id, import_id)
    references public.portfolio_imports (company_id, id) on delete cascade,
  constraint portfolio_import_rows_row_key unique (import_id, row_number)
);
create index portfolio_import_rows_company_import_idx on public.portfolio_import_rows (company_id, import_id);
comment on table public.portfolio_import_rows is
  'The data rows of a portfolio import, as read from the file. Members read; company admins and property managers write them with their batch.';

create trigger set_updated_at before update on public.portfolio_imports
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.portfolio_imports
  for each row execute function private.prevent_company_change();
create trigger prevent_company_change before update on public.portfolio_import_rows
  for each row execute function private.prevent_company_change();

-- --------------------------------------------------------------------------- guards

-- Who uploaded the file and when come from the signed-in user, never from the client; the service role (no
-- auth.uid()) keeps what it supplies, like the other stamping triggers. Units are only imported into a property that
-- is not archived.
create function private.guard_portfolio_import()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.uploaded_by_user_id := (select auth.uid());
    new.uploaded_at := now();
  end if;

  if new.property_id is not null and exists (
    select 1 from public.properties p
    where p.company_id = new.company_id and p.id = new.property_id and p.status = 'archived'
  ) then
    raise exception 'This property is archived. Restore it before importing units into it.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_portfolio_import() from public, anon, authenticated;

create trigger guard_insert before insert on public.portfolio_imports
  for each row execute function private.guard_portfolio_import();

-- --------------------------------------------------------------------------- audit

create function private.audit_portfolio_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'upload', 'portfolio_import', new.id,
      format('Portfolio file %s uploaded: %s %s', new.file_name, new.row_count, case when new.row_count = 1 then 'row' else 'rows' end),
      jsonb_build_array(
        private.field_change('fileName', null::text, new.file_name),
        private.field_change('scope', null::text, new.scope),
        private.field_change('sheetName', null::text, new.sheet_name),
        private.field_change('rowCount', null::integer, new.row_count)
      )
    );
    return null;
  end if;

  if new.sheet_name is distinct from old.sheet_name then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.id,
      format('Portfolio file %s now read from the sheet %s', new.file_name, new.sheet_name),
      jsonb_build_array(
        private.field_change('sheetName', old.sheet_name, new.sheet_name),
        private.field_change('rowCount', old.row_count, new.row_count)
      )
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_portfolio_import() from public, anon, authenticated;

create trigger audit_change after insert or update on public.portfolio_imports
  for each row execute function private.audit_portfolio_import();

-- --------------------------------------------------------------------------- privileges and RLS

alter table public.portfolio_imports enable row level security;
alter table public.portfolio_import_rows enable row level security;
revoke all on public.portfolio_imports, public.portfolio_import_rows from anon, authenticated;
grant select, insert, update, delete on public.portfolio_imports, public.portfolio_import_rows to service_role;

grant select on public.portfolio_imports, public.portfolio_import_rows to authenticated;
-- The uploader and time are stamped by the guard; a batch is never deleted by a person (its history is kept).
grant insert (
  id, company_id, scope, property_id, file_name, storage_path, file_format, size_bytes, file_sha256,
  sheet_name, sheet_names, delimiter, columns, row_count
) on public.portfolio_imports to authenticated;
grant update (sheet_name, columns, row_count) on public.portfolio_imports to authenticated;
grant insert (company_id, import_id, row_number, cells), delete on public.portfolio_import_rows to authenticated;

create policy members_read on public.portfolio_imports for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));
create policy writers_insert on public.portfolio_imports for insert to authenticated
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));
create policy writers_update on public.portfolio_imports for update to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));

create policy members_read on public.portfolio_import_rows for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));
create policy writers_insert on public.portfolio_import_rows for insert to authenticated
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));
create policy writers_delete on public.portfolio_import_rows for delete to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));

-- --------------------------------------------------------------------------- write functions

-- p_rows: [{"rowNumber": 2, "cells": ["MSQ", "Market Square", …]}, …], as parsed by the API.
create function public.create_portfolio_import(
  p_id uuid,
  p_company_id uuid,
  p_scope text,
  p_property_id uuid,
  p_file_name text,
  p_storage_path text,
  p_file_format text,
  p_size_bytes bigint,
  p_file_sha256 text,
  p_sheet_name text,
  p_sheet_names text[],
  p_delimiter text,
  p_columns text[],
  p_rows jsonb
)
returns public.portfolio_imports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  insert into public.portfolio_imports (
    id, company_id, scope, property_id, file_name, storage_path, file_format, size_bytes, file_sha256,
    sheet_name, sheet_names, delimiter, columns, row_count
  )
  values (
    p_id, p_company_id, p_scope, p_property_id, p_file_name, p_storage_path, p_file_format, p_size_bytes, p_file_sha256,
    p_sheet_name, coalesce(p_sheet_names, '{}'), p_delimiter, p_columns, jsonb_array_length(p_rows)
  )
  returning * into v_import;

  insert into public.portfolio_import_rows (company_id, import_id, row_number, cells)
  select p_company_id, p_id, (r.value ->> 'rowNumber')::integer, r.value -> 'cells'
  from jsonb_array_elements(p_rows) as r (value);

  return v_import;
end;
$$;
revoke all on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb)
  from public, anon;
grant execute on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb)
  to authenticated, service_role;
comment on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb) is
  'Company admins and property managers (RLS). Records an uploaded portfolio file and its parsed rows in one transaction.';

-- Reads the batch from another worksheet of the same workbook: its columns, row count and rows are replaced.
create function public.replace_portfolio_import_sheet(
  p_company_id uuid,
  p_import_id uuid,
  p_sheet_name text,
  p_columns text[],
  p_rows jsonb
)
returns public.portfolio_imports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  update public.portfolio_imports
  set sheet_name = p_sheet_name, columns = p_columns, row_count = jsonb_array_length(p_rows)
  where company_id = p_company_id and id = p_import_id
  returning * into v_import;
  if v_import.id is null then
    raise exception 'Portfolio import not found' using errcode = 'P0002';
  end if;

  delete from public.portfolio_import_rows where company_id = p_company_id and import_id = p_import_id;
  insert into public.portfolio_import_rows (company_id, import_id, row_number, cells)
  select p_company_id, p_import_id, (r.value ->> 'rowNumber')::integer, r.value -> 'cells'
  from jsonb_array_elements(p_rows) as r (value);

  return v_import;
end;
$$;
revoke all on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) from public, anon;
grant execute on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) to authenticated, service_role;
comment on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) is
  'Company admins and property managers (RLS). Re-reads a portfolio import from another worksheet: columns, row count and rows are replaced.';

-- --------------------------------------------------------------------------- storage: portfolio-imports bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio-imports', 'portfolio-imports', false, 5242880,
  array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy portfolio_imports_members_read on storage.objects for select to authenticated
  using (
    bucket_id = 'portfolio-imports'
    and private.storage_company_id(name) = any ((select private.member_company_ids())::uuid[])
  );
create policy portfolio_imports_writers_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portfolio-imports'
    and private.is_storage_object_path(name, private.storage_company_id(name))
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
