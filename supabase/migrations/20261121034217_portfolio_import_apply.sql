-- Portfolio import, ticket I-04 (approve and apply): the manager approves a batch and LeaseGuard creates its new
-- properties and units in one transaction, through the same tables, column grants, RLS policies, guards and audit
-- triggers the property and unit forms write through (no second data model). Rows still blocked stay out.
--
--   * apply_portfolio_import: inserts the properties and units the API planned from the checked rows, then stamps the
--     approval on the batch; all of it lands or none of it does (SECURITY INVOKER: RLS, grants and triggers apply as
--     to a direct write). The unique property code and unit number per property refuse a second copy of a record, so
--     approving twice, or importing the same file again, never creates duplicates;
--   * the transaction-local settings leaseguard.portfolio_import_id / leaseguard.portfolio_import_row name the batch
--     and the row each insert comes from. Only apply_portfolio_import sets them, around its inserts; the Data API offers
--     no way to set them;
--   * portfolio_import_records: every property and unit an import created, with its batch and row (written by a
--     trigger on properties and units while the setting names a batch of the same company), listed on the batch;
--   * portfolio_imports.approved_by_user_id / approved_at: the last approval's sign-off (stamped from auth.uid(), and
--     only while apply_portfolio_import runs);
--   * audit: each created property and unit is recorded as created by import with the batch reference, and the
--     approval itself on the batch ('approve').
-- Importing never enables or sends tenant messaging: nothing here writes communications, approvals or schedules.

-- --------------------------------------------------------------------------- the batch's approval

alter table public.portfolio_imports
  add column approved_by_user_id uuid,
  add column approved_at timestamptz,
  add constraint portfolio_imports_approved_by_fk foreign key (company_id, approved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (approved_by_user_id);
create index portfolio_imports_approved_by_idx on public.portfolio_imports (company_id, approved_by_user_id)
  where approved_by_user_id is not null;
comment on column public.portfolio_imports.approved_by_user_id is
  'Who last approved the import (stamped from auth.uid() by apply_portfolio_import).';
comment on column public.portfolio_imports.approved_at is 'When the import was last approved and its new records created.';

grant update (approved_at) on public.portfolio_imports to authenticated;

-- --------------------------------------------------------------------------- the import being applied

-- The batch the current transaction is applying, when apply_portfolio_import set it; null otherwise.
create function private.applying_portfolio_import()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('leaseguard.portfolio_import_id', true), '')::uuid
$$;
revoke all on function private.applying_portfolio_import() from public, anon;
-- Read by the approval guard, which runs as the caller; it only reads a setting.
grant execute on function private.applying_portfolio_import() to authenticated;

-- The row of that batch the current insert comes from.
create function private.applying_portfolio_import_row()
returns integer
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('leaseguard.portfolio_import_row', true), '')::integer
$$;
revoke all on function private.applying_portfolio_import_row() from public, anon, authenticated;

-- The batch being applied, when it is one of p_company_id's: the batch reference an audit entry carries.
create function private.applying_portfolio_import_of(p_company_id uuid)
returns public.portfolio_imports
language sql
stable
security definer
set search_path = ''
as $$
  select i.* from public.portfolio_imports i
  where i.company_id = p_company_id and i.id = private.applying_portfolio_import()
$$;
revoke all on function private.applying_portfolio_import_of(uuid) from public, anon, authenticated;

-- An approval is stamped only by apply_portfolio_import, from the signed-in user.
create function private.guard_portfolio_import_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approved_at is not distinct from old.approved_at then
    return new;
  end if;
  if private.applying_portfolio_import() is distinct from new.id then
    raise exception 'An import is approved only by applying it' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null then
    new.approved_by_user_id := (select auth.uid());
    new.approved_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_portfolio_import_approval() from public, anon, authenticated;

create trigger guard_approval before update on public.portfolio_imports
  for each row execute function private.guard_portfolio_import_approval();

-- --------------------------------------------------------------------------- created records

create table public.portfolio_import_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  import_id uuid not null,
  -- The batch row the record was created from.
  row_number integer not null check (row_number >= 1),
  record_type text not null check (record_type in ('property', 'unit')),
  -- The property created, or the property of the unit created.
  property_id uuid not null,
  unit_id uuid,
  created_at timestamptz not null default now(),
  constraint portfolio_import_records_unit_check check ((record_type = 'unit') = (unit_id is not null)),
  constraint portfolio_import_records_import_fk foreign key (company_id, import_id)
    references public.portfolio_imports (company_id, id) on delete cascade,
  constraint portfolio_import_records_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id) on delete cascade,
  constraint portfolio_import_records_unit_fk foreign key (company_id, unit_id)
    references public.units (company_id, id) on delete cascade
);
create index portfolio_import_records_import_idx on public.portfolio_import_records (company_id, import_id, row_number);
create unique index portfolio_import_records_property_key on public.portfolio_import_records (property_id) where record_type = 'property';
create unique index portfolio_import_records_unit_key on public.portfolio_import_records (unit_id) where unit_id is not null;
create index portfolio_import_records_unit_property_idx on public.portfolio_import_records (company_id, property_id);
comment on table public.portfolio_import_records is
  'Every property and unit a portfolio import created, with its batch and row. Written by a trigger while apply_portfolio_import runs; members read.';

create trigger prevent_company_change before update on public.portfolio_import_records
  for each row execute function private.prevent_company_change();

alter table public.portfolio_import_records enable row level security;
revoke all on public.portfolio_import_records from anon, authenticated;
grant select, insert, update, delete on public.portfolio_import_records to service_role;
grant select on public.portfolio_import_records to authenticated;

create policy members_read on public.portfolio_import_records for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- Records the property or unit just inserted against the batch being applied (of the same company).
create function private.record_portfolio_import_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.portfolio_imports := private.applying_portfolio_import_of(new.company_id);
begin
  if v_import.id is null then
    return null;
  end if;
  insert into public.portfolio_import_records (company_id, import_id, row_number, record_type, property_id, unit_id)
  values (
    new.company_id, v_import.id, coalesce(private.applying_portfolio_import_row(), 1),
    case tg_table_name when 'units' then 'unit' else 'property' end,
    case tg_table_name when 'units' then (to_jsonb(new) ->> 'property_id')::uuid else new.id end,
    case tg_table_name when 'units' then new.id end
  );
  return null;
end;
$$;
revoke all on function private.record_portfolio_import_creation() from public, anon, authenticated;

create trigger record_portfolio_import after insert on public.properties
  for each row execute function private.record_portfolio_import_creation();
create trigger record_portfolio_import after insert on public.units
  for each row execute function private.record_portfolio_import_creation();

-- --------------------------------------------------------------------------- audit: created by import

-- The property audit trigger (20261111100700), with a created property marked as created by import with the batch
-- reference when an import is being applied. Updates are unchanged.
create or replace function private.audit_property_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields constant text[] := array[
    'name', 'code', 'type', 'status',
    'address_line1', 'address_line2', 'suburb', 'city', 'province', 'postal_code',
    'description', 'gross_lettable_area_sqm', 'manager_user_id', 'owner_user_id', 'accounting_system'
  ];
  v_old jsonb;
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
  v_import public.portfolio_imports;
begin
  if tg_op = 'INSERT' then
    v_import := private.applying_portfolio_import_of(new.company_id);
    perform private.write_audit(
      new.company_id, 'create', 'property', new.id,
      case when v_import.id is null then format('Property %s (%s) created', new.name, new.code)
        else format('Property %s (%s) created by import of %s, row %s', new.name, new.code, v_import.file_name,
          private.applying_portfolio_import_row()) end,
      jsonb_build_array(
        private.field_change('name', null::text, new.name),
        private.field_change('code', null::text, new.code),
        private.field_change('status', null::text, new.status::text)
      ) || case when v_import.id is null then '[]'::jsonb else jsonb_build_array(
        private.field_change('portfolioImportId', null::uuid, v_import.id),
        private.field_change('portfolioImportRow', null::integer, private.applying_portfolio_import_row())
      ) end
    );
    return null;
  end if;

  v_old := to_jsonb(old);
  select jsonb_agg(
    jsonb_build_object('field', f.field, 'before', private.audit_scalar(v_old -> f.field), 'after', private.audit_scalar(v_new -> f.field))
    order by f.ordinality
  )
  into v_changes
  from unnest(v_fields) with ordinality as f (field, ordinality)
  where (v_old -> f.field) is distinct from (v_new -> f.field);

  if v_changes is null then
    return null;
  end if;

  if new.status = 'archived' and old.status <> 'archived' then
    perform private.write_audit(new.company_id, 'archive', 'property', new.id, format('Property %s archived', new.name), v_changes);
  elsif old.status = 'archived' and new.status <> 'archived' then
    perform private.write_audit(new.company_id, 'update', 'property', new.id, format('Property %s restored', new.name), v_changes);
  else
    perform private.write_audit(new.company_id, 'update', 'property', new.id, format('Property %s updated', new.name), v_changes);
  end if;
  return null;
end;
$$;

-- The unit audit trigger (20261120151342), with a created unit marked as created by import with the batch reference
-- when an import is being applied. Updates are unchanged.
create or replace function private.audit_unit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields constant text[] := array['unit_number', 'type', 'floor_area_sqm', 'floor', 'occupancy_status', 'description'];
  v_old jsonb;
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
  v_property text;
  v_import public.portfolio_imports;
begin
  select p.name into v_property from public.properties p where p.company_id = new.company_id and p.id = new.property_id;

  if tg_op = 'INSERT' then
    v_import := private.applying_portfolio_import_of(new.company_id);
    perform private.write_audit(
      new.company_id, 'create', 'unit', new.id,
      case when v_import.id is null then format('Unit %s created in %s', new.unit_number, v_property)
        else format('Unit %s created in %s by import of %s, row %s', new.unit_number, v_property, v_import.file_name,
          private.applying_portfolio_import_row()) end,
      jsonb_build_array(
        private.field_change('unit_number', null::text, new.unit_number),
        private.field_change('type', null::text, new.type::text),
        private.field_change('occupancy_status', null::text, new.occupancy_status::text)
      ) || case when v_import.id is null then '[]'::jsonb else jsonb_build_array(
        private.field_change('portfolioImportId', null::uuid, v_import.id),
        private.field_change('portfolioImportRow', null::integer, private.applying_portfolio_import_row())
      ) end
    );
    return null;
  end if;

  -- The derived current tenant and lease are not audited here: the lease change that moves them is.
  v_old := to_jsonb(old);
  select jsonb_agg(
    jsonb_build_object('field', f.field, 'before', private.audit_scalar(v_old -> f.field), 'after', private.audit_scalar(v_new -> f.field))
    order by f.ordinality
  )
  into v_changes
  from unnest(v_fields) with ordinality as f (field, ordinality)
  where (v_old -> f.field) is distinct from (v_new -> f.field);

  if v_changes is null then
    return null;
  end if;

  if jsonb_array_length(v_changes) = 1 and new.occupancy_status is distinct from old.occupancy_status then
    perform private.write_audit(
      new.company_id, 'update', 'unit', new.id,
      format('Unit %s in %s changed from %s to %s', new.unit_number, v_property,
        private.occupancy_label(old.occupancy_status), private.occupancy_label(new.occupancy_status)),
      v_changes
    );
  else
    perform private.write_audit(new.company_id, 'update', 'unit', new.id, format('Unit %s in %s updated', new.unit_number, v_property), v_changes);
  end if;
  return null;
end;
$$;

-- The batch's audit trigger (20261121001814), extended with the approval: unchanged for uploads, worksheet changes and
-- mappings.
create or replace function private.audit_portfolio_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_properties integer;
  v_units integer;
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

  if new.approved_at is distinct from old.approved_at then
    -- The records this approval created: written earlier in the same transaction (created_at is its start time).
    select count(*) filter (where r.record_type = 'property'), count(*) filter (where r.record_type = 'unit')
    into v_properties, v_units
    from public.portfolio_import_records r
    where r.company_id = new.company_id and r.import_id = new.id and r.created_at = now();
    perform private.write_audit(
      new.company_id, 'approve', 'portfolio_import', new.id,
      format('Portfolio file %s approved: %s %s and %s %s created', new.file_name,
        v_properties, case when v_properties = 1 then 'property' else 'properties' end,
        v_units, case when v_units = 1 then 'unit' else 'units' end),
      jsonb_build_array(
        private.field_change('approvedAt', old.approved_at, new.approved_at),
        private.field_change('propertiesCreated', null::integer, v_properties),
        private.field_change('unitsCreated', null::integer, v_units)
      )
    );
  elsif new.sheet_name is distinct from old.sheet_name then
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

-- --------------------------------------------------------------------------- write function

-- p_properties: [{"row_number": 2, "code": "MSQ", "name": …, <every other properties insert column>}, …]
-- p_units: [{"row_number": 2, "property_id": <existing property> | null, "property_code": <a property of p_properties>
--            | null, "unit_number": …, <every other units insert column>}, …]
-- Both are built by the API from the rows checked against the live records, with the property and unit forms'
-- validation. Returns the batch with its approval.
create function public.apply_portfolio_import(
  p_company_id uuid,
  p_import_id uuid,
  p_properties jsonb,
  p_units jsonb
)
returns public.portfolio_imports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_item jsonb;
  v_property public.properties;
  v_unit public.units;
  v_property_id uuid;
  v_created jsonb := '{}';
begin
  if jsonb_typeof(p_properties) is distinct from 'array' or jsonb_typeof(p_units) is distinct from 'array' then
    raise exception 'p_properties and p_units must be JSON arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(p_properties) + jsonb_array_length(p_units) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;

  -- One approval of a batch at a time; the second waits and then finds the records already there (unique keys).
  select * into v_import from public.portfolio_imports i
  where i.company_id = p_company_id and i.id = p_import_id
  for update;
  if v_import.id is null then
    raise exception 'Portfolio import not found' using errcode = 'P0002';
  end if;
  if v_import.scope = 'units' and jsonb_array_length(p_properties) > 0 then
    raise exception 'This import adds units to one property' using errcode = '22023';
  end if;

  perform set_config('leaseguard.portfolio_import_id', p_import_id::text, true);

  for v_item in select value from jsonb_array_elements(p_properties) loop
    v_property := jsonb_populate_record(null::public.properties, v_item);
    perform set_config('leaseguard.portfolio_import_row', (v_item ->> 'row_number')::integer::text, true);
    insert into public.properties (
      company_id, name, code, type, status,
      address_line1, address_line2, suburb, city, province, postal_code,
      description, gross_lettable_area_sqm, manager_user_id, owner_user_id, accounting_system
    )
    values (
      p_company_id, v_property.name, v_property.code, v_property.type, coalesce(v_property.status, 'active'),
      v_property.address_line1, v_property.address_line2, v_property.suburb, v_property.city, v_property.province,
      v_property.postal_code, coalesce(v_property.description, ''), v_property.gross_lettable_area_sqm,
      v_property.manager_user_id, v_property.owner_user_id, v_property.accounting_system
    )
    returning id into v_property_id;
    v_created := v_created || jsonb_build_object(v_property.code, v_property_id);
  end loop;

  for v_item in select value from jsonb_array_elements(p_units) loop
    v_unit := jsonb_populate_record(null::public.units, v_item);
    v_property_id := case
      when v_import.scope = 'units' then v_import.property_id
      when v_item ->> 'property_code' is not null then (v_created ->> (v_item ->> 'property_code'))::uuid
      else v_unit.property_id
    end;
    if v_property_id is null then
      raise exception 'A unit names a property that is neither in LeaseGuard nor created by this import' using errcode = '22023';
    end if;
    perform set_config('leaseguard.portfolio_import_row', (v_item ->> 'row_number')::integer::text, true);
    insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm, floor, occupancy_status, description)
    values (
      p_company_id, v_property_id, v_unit.unit_number, v_unit.type, v_unit.floor_area_sqm, v_unit.floor,
      coalesce(v_unit.occupancy_status, 'vacant'), v_unit.description
    );
  end loop;

  update public.portfolio_imports set approved_at = now()
  where company_id = p_company_id and id = p_import_id
  returning * into v_import;

  perform set_config('leaseguard.portfolio_import_row', '', true);
  perform set_config('leaseguard.portfolio_import_id', '', true);
  return v_import;
end;
$$;
revoke all on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
comment on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb) is
  'Company admins and property managers (RLS). Creates the approved properties and units of a portfolio import in one transaction and stamps the approval.';
