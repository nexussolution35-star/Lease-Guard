-- Portfolio import, ticket I-06 (import from a Google Sheets link): instead of uploading a file, a company admin or
-- property manager pastes a Google Sheets link. The API fetches the sheet's CSV export itself, keeps what it read in
-- the portfolio-imports bucket like an uploaded CSV file, and records the same import batch.
--
--   * portfolio_imports.google_spreadsheet_id / google_sheet_gid: the sheet the batch was read from (the tab is null
--     when the link named none and the first tab was read). Such a batch is always a CSV batch: its file is the CSV
--     snapshot, so the batch stays reproducible when the sheet changes;
--   * create_portfolio_import takes the two values (optional, so a file upload calls it as before).
-- The batch's audit entry is the one an upload writes ('upload', with the file name Google gave the export).

alter table public.portfolio_imports
  add column google_spreadsheet_id text check (google_spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  add column google_sheet_gid text check (google_sheet_gid ~ '^[0-9]{1,12}$'),
  add constraint portfolio_imports_google_sheet_check check (
    (google_sheet_gid is null or google_spreadsheet_id is not null)
    and (google_spreadsheet_id is null or file_format = 'csv')
  );
comment on column public.portfolio_imports.google_spreadsheet_id is
  'The Google Sheet the batch was read from (null for an uploaded file); the CSV read is the batch''s stored file.';
comment on column public.portfolio_imports.google_sheet_gid is
  'The tab of the Google Sheet (its gid); null when the first tab was read.';

grant insert (google_spreadsheet_id, google_sheet_gid) on public.portfolio_imports to authenticated;

-- --------------------------------------------------------------------------- write function

drop function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb);

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
  p_rows jsonb,
  p_google_spreadsheet_id text default null,
  p_google_sheet_gid text default null
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
    sheet_name, sheet_names, delimiter, columns, row_count, google_spreadsheet_id, google_sheet_gid
  )
  values (
    p_id, p_company_id, p_scope, p_property_id, p_file_name, p_storage_path, p_file_format, p_size_bytes, p_file_sha256,
    p_sheet_name, coalesce(p_sheet_names, '{}'), p_delimiter, p_columns, jsonb_array_length(p_rows),
    p_google_spreadsheet_id, p_google_sheet_gid
  )
  returning * into v_import;

  insert into public.portfolio_import_rows (company_id, import_id, row_number, cells)
  select p_company_id, p_id, (r.value ->> 'rowNumber')::integer, r.value -> 'cells'
  from jsonb_array_elements(p_rows) as r (value);

  return v_import;
end;
$$;
revoke all on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb, text, text)
  from public, anon;
grant execute on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb, text, text)
  to authenticated, service_role;
comment on function public.create_portfolio_import(uuid, uuid, text, uuid, text, text, text, bigint, text, text, text[], text, text[], jsonb, text, text) is
  'Company admins and property managers (RLS). Records a portfolio file (uploaded, or read from a Google Sheet) and its parsed rows in one transaction.';
