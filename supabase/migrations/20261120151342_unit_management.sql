-- Unit management (PRD module 3): create and edit units, all audited.
--
-- Writers (company_admin, property_manager) already held table-wide INSERT, UPDATE and DELETE on
-- units through RLS. This migration narrows that to what the product allows:
--   * no hard delete: leases, statements and arrangements reference units;
--   * column grants: the company and the property are fixed after creation (leases, statements and
--     arrangements reference the unit together with its property), and the current tenant and lease
--     are derived from the active lease, never typed in;
--   * guards: an archived property's units are read-only, and no unit is added to it, until the
--     property is restored; a unit with a current lease stays occupied;
--   * audit: create and update are recorded with the signed-in user as actor; occupancy status
--     changes are summarised as such.

-- --------------------------------------------------------------------------- privileges

revoke insert, update, delete on public.units from authenticated;
grant insert (company_id, property_id, unit_number, type, floor_area_sqm, floor, occupancy_status, description)
  on public.units to authenticated;
grant update (unit_number, type, floor_area_sqm, floor, occupancy_status, description)
  on public.units to authenticated;

-- --------------------------------------------------------------------------- guards

-- Applies to every role (the service role included): these are product rules, not permissions.
create function private.guard_unit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Columns a person edits; the current tenant and lease are derived and stay writable for the lease rules.
  v_editable constant text[] := array['property_id', 'unit_number', 'type', 'floor_area_sqm', 'floor', 'occupancy_status', 'description'];
begin
  -- SECURITY DEFINER runs before Row Level Security's WITH CHECK on INSERT: a signed-in caller who
  -- cannot write the target company is refused as RLS would, before another company's property is read.
  if (select auth.uid()) is not null
     and not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'new row violates row-level security policy for table "units"' using errcode = '42501';
  end if;

  if (tg_op = 'INSERT'
      or exists (
        select 1 from unnest(v_editable) as f (field)
        where (to_jsonb(new) -> f.field) is distinct from (to_jsonb(old) -> f.field)
      ))
     and exists (
       select 1 from public.properties p
       where p.company_id = new.company_id and p.id = new.property_id and p.status = 'archived'
     ) then
    raise exception 'This property is archived. Restore it before adding or changing its units.' using errcode = 'P0001';
  end if;

  if new.current_lease_id is not null and new.occupancy_status <> 'occupied'
     and (tg_op = 'INSERT' or new.occupancy_status is distinct from old.occupancy_status) then
    raise exception 'This unit has a current lease, so it stays occupied until the lease ends.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_unit_change() from public, anon, authenticated;

create trigger guard_change before insert or update on public.units
  for each row execute function private.guard_unit_change();

-- --------------------------------------------------------------------------- audit

create function private.occupancy_label(p_status public.occupancy_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(p_status::text, '_', ' ')
$$;
revoke all on function private.occupancy_label(public.occupancy_status) from public, anon, authenticated;

create function private.audit_unit_change()
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
begin
  select p.name into v_property from public.properties p where p.company_id = new.company_id and p.id = new.property_id;

  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'create', 'unit', new.id,
      format('Unit %s created in %s', new.unit_number, v_property),
      jsonb_build_array(
        private.field_change('unit_number', null::text, new.unit_number),
        private.field_change('type', null::text, new.type::text),
        private.field_change('occupancy_status', null::text, new.occupancy_status::text)
      )
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
revoke all on function private.audit_unit_change() from public, anon, authenticated;

create trigger audit_change after insert or update on public.units
  for each row execute function private.audit_unit_change();

-- The unit list's default order within a company (unit number), and the property filter.
create index if not exists units_company_property_number_idx on public.units (company_id, property_id, unit_number);
