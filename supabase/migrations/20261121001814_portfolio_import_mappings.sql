-- Portfolio import, ticket I-02 (map columns and preview): the manager sees how the file's columns map to LeaseGuard
-- fields and can change any mapping; the API then checks every row against the database. Nothing is written to
-- properties or units.
--
--   * portfolio_imports.column_mapping: the mapping the manager applied to this batch ({"<field key>": "<column>"},
--     only mapped fields); null until one is applied, and cleared when another worksheet is read (its columns differ);
--   * portfolio_import_mappings: the last mapping a company applied to a file with the same headings, per scope, so
--     the next file with those headings starts from it. The headings are identified by header_signature, the SHA-256
--     of the normalised headings computed by the API;
--   * save_portfolio_import_mapping: applies a mapping to a batch and saves it for the headings in one transaction
--     (SECURITY INVOKER: RLS, grants and triggers apply as to a direct write);
--   * audit: applying a mapping is recorded on the batch ('update').
-- The preview (each row's result) is computed by the API on request from the batch rows and the live properties and
-- units, so it is never stored and never stale.

-- --------------------------------------------------------------------------- the batch's mapping

alter table public.portfolio_imports
  add column column_mapping jsonb check (column_mapping is null or jsonb_typeof(column_mapping) = 'object');
comment on column public.portfolio_imports.column_mapping is
  'The column mapping applied to this batch: {"<LeaseGuard field key>": "<file column heading>"}, mapped fields only. Null until one is applied.';

grant update (column_mapping) on public.portfolio_imports to authenticated;

-- Another worksheet has other columns, so a mapping applied to the previous one no longer fits.
create function private.reset_portfolio_import_mapping()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.columns is distinct from old.columns and new.column_mapping is not distinct from old.column_mapping then
    new.column_mapping := null;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_portfolio_import_mapping() from public, anon, authenticated;

create trigger reset_mapping before update on public.portfolio_imports
  for each row execute function private.reset_portfolio_import_mapping();

-- The batch's audit trigger, extended with the mapping: unchanged for uploads and worksheet changes.
create or replace function private.audit_portfolio_import()
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
  elsif new.column_mapping is not null and new.column_mapping is distinct from old.column_mapping then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.id,
      format('Column mapping applied to portfolio file %s', new.file_name),
      jsonb_build_array(private.field_change('columnMapping', old.column_mapping, new.column_mapping))
    );
  end if;
  return null;
end;
$$;

-- --------------------------------------------------------------------------- saved mappings

create table public.portfolio_import_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scope text not null check (scope in ('properties', 'units')),
  -- SHA-256 (hex) of the file's headings after normalisation (trimmed, lower case), in file order.
  header_signature text not null check (header_signature ~ '^[0-9a-f]{64}$'),
  -- The headings as they were in the file the mapping was saved from (for people reading the table).
  columns text[] not null check (cardinality(columns) between 1 and 100),
  column_mapping jsonb not null check (jsonb_typeof(column_mapping) = 'object'),
  saved_by_user_id uuid,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_import_mappings_headers_key unique (company_id, scope, header_signature),
  constraint portfolio_import_mappings_saved_by_fk foreign key (company_id, saved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (saved_by_user_id)
);
create index portfolio_import_mappings_saved_by_idx on public.portfolio_import_mappings (company_id, saved_by_user_id)
  where saved_by_user_id is not null;
comment on table public.portfolio_import_mappings is
  'The last column mapping a company applied to a portfolio file with the same headings, reused for the next such file. Members read; company admins and property managers save.';

create trigger set_updated_at before update on public.portfolio_import_mappings
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.portfolio_import_mappings
  for each row execute function private.prevent_company_change();

-- Who saved the mapping and when come from the signed-in user, never from the client.
create function private.stamp_portfolio_import_mapping()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.saved_by_user_id := (select auth.uid());
    new.saved_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_portfolio_import_mapping() from public, anon, authenticated;

create trigger stamp_saved_by before insert or update on public.portfolio_import_mappings
  for each row execute function private.stamp_portfolio_import_mapping();

alter table public.portfolio_import_mappings enable row level security;
revoke all on public.portfolio_import_mappings from anon, authenticated;
grant select, insert, update, delete on public.portfolio_import_mappings to service_role;
grant select on public.portfolio_import_mappings to authenticated;
grant insert (company_id, scope, header_signature, columns, column_mapping) on public.portfolio_import_mappings to authenticated;
grant update (columns, column_mapping) on public.portfolio_import_mappings to authenticated;

create policy members_read on public.portfolio_import_mappings for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));
create policy writers_insert on public.portfolio_import_mappings for insert to authenticated
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));
create policy writers_update on public.portfolio_import_mappings for update to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));

-- --------------------------------------------------------------------------- write function

-- Applies p_mapping to the batch and saves it as the company's mapping for these headings and the batch's scope.
create function public.save_portfolio_import_mapping(
  p_company_id uuid,
  p_import_id uuid,
  p_header_signature text,
  p_mapping jsonb
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
  update public.portfolio_imports
  set column_mapping = p_mapping
  where company_id = p_company_id and id = p_import_id
  returning * into v_import;
  if v_import.id is null then
    raise exception 'Portfolio import not found' using errcode = 'P0002';
  end if;

  insert into public.portfolio_import_mappings (company_id, scope, header_signature, columns, column_mapping)
  values (p_company_id, v_import.scope, p_header_signature, v_import.columns, p_mapping)
  on conflict (company_id, scope, header_signature)
    do update set columns = excluded.columns, column_mapping = excluded.column_mapping;

  return v_import;
end;
$$;
revoke all on function public.save_portfolio_import_mapping(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_portfolio_import_mapping(uuid, uuid, text, jsonb) to authenticated, service_role;
comment on function public.save_portfolio_import_mapping(uuid, uuid, text, jsonb) is
  'Company admins and property managers (RLS). Applies a column mapping to a portfolio import and saves it for the next file with the same headings.';
