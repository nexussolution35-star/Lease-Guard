-- Portfolio import, ticket I-03 (resolve row exceptions): in the preview, the manager corrects a row's value, skips a
-- row, or links it to an existing property or unit instead of creating a new one. The changes are kept on the batch
-- row, never on the live property or unit; the API checks the row again with them on every preview.
--
--   * portfolio_import_rows.corrections: the manager's values per LeaseGuard field ({"<field key>": "<value>"}; an
--     empty string clears the file's value), used instead of the file's cells;
--   * portfolio_import_rows.skipped: the row is left out of the import;
--   * portfolio_import_rows.linked_property_id / linked_unit_id: the existing property and unit the row stands for, so
--     nothing new is created for them and the file's values for them are not used;
--   * changed_by_user_id / changed_at: who made the last change to the row and when (stamped from auth.uid(), never a
--     value the client sent), shown as the row's sign-off;
--   * private.guard_portfolio_import_row_change: a linked unit belongs to the linked property (or the batch's own
--     property for a units batch), and a units batch links units only;
--   * audit: every change is recorded on the batch ('update') with the row number and, per value, the previous and
--     new value (a correction's previous value is the file's cell under the batch's applied mapping, or the earlier
--     correction).

-- --------------------------------------------------------------------------- columns

alter table public.portfolio_import_rows
  add column corrections jsonb not null default '{}' check (jsonb_typeof(corrections) = 'object'),
  add column skipped boolean not null default false,
  add column linked_property_id uuid,
  add column linked_unit_id uuid,
  add column changed_by_user_id uuid,
  add column changed_at timestamptz,
  add constraint portfolio_import_rows_linked_property_fk foreign key (company_id, linked_property_id)
    references public.properties (company_id, id) on delete set null (linked_property_id),
  add constraint portfolio_import_rows_linked_unit_fk foreign key (company_id, linked_unit_id)
    references public.units (company_id, id) on delete set null (linked_unit_id),
  add constraint portfolio_import_rows_changed_by_fk foreign key (company_id, changed_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (changed_by_user_id);

create index portfolio_import_rows_linked_property_idx on public.portfolio_import_rows (company_id, linked_property_id)
  where linked_property_id is not null;
create index portfolio_import_rows_linked_unit_idx on public.portfolio_import_rows (company_id, linked_unit_id)
  where linked_unit_id is not null;
create index portfolio_import_rows_changed_by_idx on public.portfolio_import_rows (company_id, changed_by_user_id)
  where changed_by_user_id is not null;

comment on column public.portfolio_import_rows.corrections is
  'The manager''s values per LeaseGuard field ({"<field key>": "<value>"}), read instead of the file''s cells; an empty string clears the cell.';
comment on column public.portfolio_import_rows.skipped is 'The manager left this row out of the import.';
comment on column public.portfolio_import_rows.linked_property_id is
  'The existing property this row stands for (set by the manager): no property is created for it and the file''s property values are not used.';
comment on column public.portfolio_import_rows.linked_unit_id is
  'The existing unit this row stands for (set by the manager): no unit is created for it and the file''s unit values are not used.';
comment on column public.portfolio_import_rows.changed_by_user_id is 'Who last corrected, skipped or linked this row (stamped from auth.uid()).';

-- --------------------------------------------------------------------------- guard

-- Stamps who changed the row and when, and keeps a link coherent: a units batch is for its own property, so it links
-- units only, of that property; a properties batch links a unit only together with the unit's property.
create function private.guard_portfolio_import_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_unit_property uuid;
begin
  if new.corrections is not distinct from old.corrections
    and new.skipped is not distinct from old.skipped
    and new.linked_property_id is not distinct from old.linked_property_id
    and new.linked_unit_id is not distinct from old.linked_unit_id then
    return new;
  end if;

  if (select auth.uid()) is not null then
    new.changed_by_user_id := (select auth.uid());
    new.changed_at := now();
  else
    new.changed_at := coalesce(new.changed_at, now());
  end if;

  select * into v_import from public.portfolio_imports i where i.company_id = new.company_id and i.id = new.import_id;

  if v_import.scope = 'units' and new.linked_property_id is not null then
    raise exception 'This import adds units to one property: link the row to one of its units' using errcode = 'P0001';
  end if;

  if new.linked_unit_id is not null then
    select u.property_id into v_unit_property from public.units u
    where u.company_id = new.company_id and u.id = new.linked_unit_id;
    if v_unit_property is distinct from coalesce(new.linked_property_id, v_import.property_id) then
      raise exception 'The unit linked to the row must be one of the property linked to it' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.guard_portfolio_import_row_change() from public, anon, authenticated;

create trigger guard_update before update on public.portfolio_import_rows
  for each row execute function private.guard_portfolio_import_row_change();

-- --------------------------------------------------------------------------- audit

-- The file's cell for a field under the batch's applied mapping; null when the field is not mapped or the cell is
-- empty.
create function private.portfolio_import_cell(p_import public.portfolio_imports, p_cells jsonb, p_field text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(p_cells ->> (array_position(p_import.columns, p_import.column_mapping ->> p_field) - 1)), '')
$$;
revoke all on function private.portfolio_import_cell(public.portfolio_imports, jsonb, text) from public, anon, authenticated;

create function private.audit_portfolio_import_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_changes jsonb := '[]';
  v_parts text[] := '{}';
  v_field text;
  v_before text;
  v_after text;
  v_name text;
begin
  select * into v_import from public.portfolio_imports i where i.company_id = new.company_id and i.id = new.import_id;

  for v_field in
    select key from jsonb_object_keys(old.corrections) as key
    union
    select key from jsonb_object_keys(new.corrections) as key
    order by 1
  loop
    if (old.corrections -> v_field) is distinct from (new.corrections -> v_field) then
      v_before := case when old.corrections ? v_field then old.corrections ->> v_field
        else private.portfolio_import_cell(v_import, old.cells, v_field) end;
      v_after := case when new.corrections ? v_field then new.corrections ->> v_field
        else private.portfolio_import_cell(v_import, new.cells, v_field) end;
      v_changes := v_changes || jsonb_build_array(private.field_change(format('row %s %s', new.row_number, v_field), v_before, v_after));
      v_parts := v_parts || format('%s %s', v_field, case when new.corrections ? v_field then 'corrected' else 'back to the file''s value' end);
    end if;
  end loop;

  if new.skipped is distinct from old.skipped then
    v_changes := v_changes || jsonb_build_array(private.field_change(format('row %s skipped', new.row_number), old.skipped, new.skipped));
    v_parts := v_parts || case when new.skipped then 'skipped' else 'included again' end;
  end if;

  if new.linked_property_id is distinct from old.linked_property_id then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s linkedPropertyId', new.row_number), old.linked_property_id, new.linked_property_id));
    select p.name into v_name from public.properties p where p.company_id = new.company_id and p.id = new.linked_property_id;
    v_parts := v_parts || case when new.linked_property_id is null then 'property link removed' else format('linked to %s', v_name) end;
  end if;

  if new.linked_unit_id is distinct from old.linked_unit_id then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s linkedUnitId', new.row_number), old.linked_unit_id, new.linked_unit_id));
    select u.unit_number into v_name from public.units u where u.company_id = new.company_id and u.id = new.linked_unit_id;
    v_parts := v_parts || case when new.linked_unit_id is null then 'unit link removed' else format('linked to unit %s', v_name) end;
  end if;

  if jsonb_array_length(v_changes) > 0 then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.import_id,
      format('Row %s of portfolio file %s: %s', new.row_number, v_import.file_name, array_to_string(v_parts, ', ')),
      v_changes
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_portfolio_import_row_change() from public, anon, authenticated;

create trigger audit_change after update on public.portfolio_import_rows
  for each row execute function private.audit_portfolio_import_row_change();

-- --------------------------------------------------------------------------- privileges and RLS

-- Only the resolution is writable; the cells stay as read from the file, and who changed the row is stamped.
grant update (corrections, skipped, linked_property_id, linked_unit_id) on public.portfolio_import_rows to authenticated;

create policy writers_update on public.portfolio_import_rows for update to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));
