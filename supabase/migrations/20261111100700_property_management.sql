-- Property management (PRD module 2): create, edit, archive and restore properties, all audited.
--
-- Writers (company_admin, property_manager) already held table-wide INSERT, UPDATE and DELETE on
-- properties through RLS. This migration narrows that to what the product allows:
--   * no hard delete: a property is archived, never removed (units would cascade with it);
--   * column grants: the code (used in lease references), the company and the timestamps are fixed
--     after creation;
--   * guards: the manager must be a company admin or property manager of the company; an archived
--     property is read-only until it is restored; a property cannot be archived while it has a lease
--     that has not ended (draft, pending verification, active or expiring);
--   * audit: create, update, archive and restore are recorded with the signed-in user as actor.

-- --------------------------------------------------------------------------- privileges

revoke insert, update, delete on public.properties from authenticated;
grant insert (
  company_id, name, code, type,
  address_line1, address_line2, suburb, city, province, postal_code,
  description, status, gross_lettable_area_sqm, manager_user_id, owner_user_id, accounting_system
) on public.properties to authenticated;
grant update (
  name, type,
  address_line1, address_line2, suburb, city, province, postal_code,
  description, status, gross_lettable_area_sqm, manager_user_id, owner_user_id, accounting_system
) on public.properties to authenticated;

-- --------------------------------------------------------------------------- guards

-- Statuses of a lease that has not ended; a property with such a lease cannot be archived.
create function private.lease_is_live(p_status public.lease_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('draft', 'pending_verification', 'active', 'expiring')
$$;
revoke all on function private.lease_is_live(public.lease_status) from public, anon, authenticated;

-- Applies to every role (the service role included): these are product rules, not permissions.
create function private.guard_property_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'archived' then
    raise exception 'A new property cannot start archived' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.status = 'archived' and new.status = 'archived'
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'This property is archived. Restore it before changing it.' using errcode = 'P0001';
  end if;

  if (tg_op = 'INSERT' or new.manager_user_id is distinct from old.manager_user_id)
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = new.company_id
         and cu.user_id = new.manager_user_id
         and cu.role in ('company_admin', 'property_manager')
     ) then
    raise exception 'The property manager must be a company admin or property manager of this workspace' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and new.status = 'archived' and old.status <> 'archived'
     and exists (
       select 1 from public.leases l
       where l.company_id = new.company_id
         and l.property_id = new.id
         and private.lease_is_live(l.status)
     ) then
    raise exception 'This property still has leases that have not ended. End or terminate them before archiving the property.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_property_change() from public, anon, authenticated;

create trigger guard_change before insert or update on public.properties
  for each row execute function private.guard_property_change();

-- --------------------------------------------------------------------------- audit

create function private.audit_property_change()
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
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'create', 'property', new.id,
      format('Property %s (%s) created', new.name, new.code),
      jsonb_build_array(
        private.field_change('name', null::text, new.name),
        private.field_change('code', null::text, new.code),
        private.field_change('status', null::text, new.status::text)
      )
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
revoke all on function private.audit_property_change() from public, anon, authenticated;

create trigger audit_change after insert or update on public.properties
  for each row execute function private.audit_property_change();

-- Property search (name, code, city, suburb) and the list's default name order.
create index if not exists properties_company_name_idx on public.properties (company_id, name);
