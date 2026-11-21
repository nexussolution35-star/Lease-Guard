-- Assigning a tenant to a unit (ticket M4-04; owner decision 21 Nov 2026): a company admin or property manager
-- assigns a tenant to a unit directly, without a lease.
--
--   * `unit_tenant_assignments` holds every assignment, current (no `ended_at`) or ended (kept as history). A unit has
--     at most one current assignment; a tenant may hold several units.
--   * Signed-in callers never write the table: they assign and unassign through `public.assign_tenant_to_unit` and
--     `public.end_unit_tenant_assignment` (SECURITY DEFINER, writers only). The guard applies to every role:
--     the tenant and unit are of the company, the property is not archived, the unit is not let to another tenant
--     (its current lease, or an active or expiring lease) and not assigned to another tenant (who holds it is named);
--     the tenant, unit and start are fixed, and an ended assignment stays ended.
--   * Assigning marks the unit occupied straight away; unassigning returns it to vacant unless a lease keeps it
--     occupied. While assigned, a unit stays occupied.
--   * `units.current_tenant_id` is the unit's current tenant: the current lease's tenant, else the assigned tenant
--     (`private.derive_unit_current_tenant`, every role). It is no longer tied to `current_lease_id` being set.
--   * A lease of an assigned unit must be for the assigned tenant (on create, on a change of its tenant or unit, and
--     when it becomes active or expiring).
--   * Assign and unassign are audited on the unit (who, when, tenant, unit, property). An assignment never drives
--     monitoring or tenant messages: nothing here writes monitoring events or communications.

-- --------------------------------------------------------------------------- table

create table public.unit_tenant_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Set from the unit by the guard; stored so the unit is proven to be of the property (composite key).
  property_id uuid not null,
  unit_id uuid not null,
  tenant_id uuid not null,
  assigned_at timestamptz not null default now(),
  assigned_by_user_id uuid,
  ended_at timestamptz,
  ended_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_tenant_assignments_company_id_key unique (company_id, id),
  constraint unit_tenant_assignments_unit_fk foreign key (company_id, property_id, unit_id)
    references public.units (company_id, property_id, id) on delete cascade,
  constraint unit_tenant_assignments_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id) on delete cascade,
  constraint unit_tenant_assignments_assigned_by_fk foreign key (company_id, assigned_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (assigned_by_user_id),
  constraint unit_tenant_assignments_ended_by_fk foreign key (company_id, ended_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (ended_by_user_id),
  constraint unit_tenant_assignments_ended_check check (ended_at is null or ended_at >= assigned_at),
  constraint unit_tenant_assignments_ended_by_check check (ended_at is not null or ended_by_user_id is null)
);
-- One current assignment per unit.
create unique index unit_tenant_assignments_current_unit_key on public.unit_tenant_assignments (unit_id) where ended_at is null;
create index unit_tenant_assignments_unit_idx on public.unit_tenant_assignments (company_id, unit_id, assigned_at desc);
create index unit_tenant_assignments_tenant_idx on public.unit_tenant_assignments (company_id, tenant_id, assigned_at desc);
create index unit_tenant_assignments_property_current_idx on public.unit_tenant_assignments (company_id, property_id) where ended_at is null;
create index unit_tenant_assignments_assigned_by_idx on public.unit_tenant_assignments (company_id, assigned_by_user_id) where assigned_by_user_id is not null;
create index unit_tenant_assignments_ended_by_idx on public.unit_tenant_assignments (company_id, ended_by_user_id) where ended_by_user_id is not null;
comment on table public.unit_tenant_assignments is
  'A tenant assigned to a unit without a lease; current while ended_at is null, kept as history once ended. Members read; '
  'company admins and property managers assign and unassign through assign_tenant_to_unit and end_unit_tenant_assignment.';

create trigger set_updated_at before update on public.unit_tenant_assignments
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.unit_tenant_assignments
  for each row execute function private.prevent_company_change();

-- --------------------------------------------------------------------------- privileges and RLS

alter table public.unit_tenant_assignments enable row level security;
revoke all on public.unit_tenant_assignments from anon, authenticated;
grant select, insert, update, delete on public.unit_tenant_assignments to service_role;
grant select on public.unit_tenant_assignments to authenticated;

create policy members_read on public.unit_tenant_assignments for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- --------------------------------------------------------------------------- units: the current tenant

-- The current tenant no longer needs a current lease (an assigned unit has a tenant and no lease); a current lease
-- still needs its tenant, which units_current_lease_parties_fk ties to the lease.
alter table public.units drop constraint units_current_pair_check;
alter table public.units
  add constraint units_current_lease_tenant_check check (current_lease_id is null or current_tenant_id is not null);
comment on column public.units.current_tenant_id is
  'The unit''s current tenant: the current lease''s tenant, else the tenant assigned to it (derived, never typed in).';

-- Every role: without a current lease the current tenant is the assigned tenant (or none). Fires before guard_change.
create function private.derive_unit_current_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_lease_id is null then
    new.current_tenant_id := (
      select a.tenant_id from public.unit_tenant_assignments a
      where a.company_id = new.company_id and a.unit_id = new.id and a.ended_at is null
    );
  end if;
  return new;
end;
$$;
revoke all on function private.derive_unit_current_tenant() from public, anon, authenticated;

create trigger derive_current_tenant before insert or update on public.units
  for each row execute function private.derive_unit_current_tenant();

-- Every role: an assigned unit (current tenant without a current lease) stays occupied until it is unassigned.
create function private.guard_assigned_unit_occupancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
begin
  if new.current_lease_id is null and new.current_tenant_id is not null and new.occupancy_status <> 'occupied'
     and (tg_op = 'INSERT' or new.occupancy_status is distinct from old.occupancy_status) then
    select t.trading_name into v_tenant from public.tenants t where t.company_id = new.company_id and t.id = new.current_tenant_id;
    raise exception 'This unit is assigned to %, so it stays occupied until it is unassigned.', v_tenant using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_assigned_unit_occupancy() from public, anon, authenticated;

create trigger guard_occupancy_assigned before insert or update on public.units
  for each row execute function private.guard_assigned_unit_occupancy();

-- --------------------------------------------------------------------------- guard

-- The unit's holder other than p_tenant_id, in words, or null: its current lease's tenant or an active or expiring
-- lease's tenant ('let to ... under lease ...'), else its current assignment's tenant ('assigned to ...').
create function private.unit_held_by_another_tenant(p_company_id uuid, p_unit_id uuid, p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select format('let to %s under lease %s', t.trading_name, l.reference)
      from public.units u
      join public.leases l on l.company_id = u.company_id and l.unit_id = u.id
      join public.tenants t on t.company_id = l.company_id and t.id = l.tenant_id
      where u.company_id = p_company_id and u.id = p_unit_id and l.tenant_id <> p_tenant_id
        and (l.id = u.current_lease_id or l.status in ('active', 'expiring'))
      order by (l.id = u.current_lease_id) desc, l.commencement_date desc, l.id
      limit 1
    ),
    (
      select format('assigned to %s', t.trading_name)
      from public.unit_tenant_assignments a
      join public.tenants t on t.company_id = a.company_id and t.id = a.tenant_id
      where a.company_id = p_company_id and a.unit_id = p_unit_id and a.ended_at is null and a.tenant_id <> p_tenant_id
    )
  )
$$;
revoke all on function private.unit_held_by_another_tenant(uuid, uuid, uuid) from public, anon, authenticated;

-- Applies to every role (the service role included): these are product rules, not permissions.
create function private.guard_unit_tenant_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units;
  v_property public.properties;
  v_holder text;
begin
  if (select auth.uid()) is not null
     and not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'new row violates row-level security policy for table "unit_tenant_assignments"' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.unit_id is distinct from old.unit_id
       or new.property_id is distinct from old.property_id or new.assigned_at is distinct from old.assigned_at
       or new.assigned_by_user_id is distinct from old.assigned_by_user_id then
      raise exception 'An assignment''s tenant, unit and start are fixed. Unassign the unit and assign it again.' using errcode = 'P0001';
    end if;
    if old.ended_at is not null then
      if new.ended_at is distinct from old.ended_at or new.ended_by_user_id is distinct from old.ended_by_user_id then
        raise exception 'This assignment has already ended.' using errcode = 'P0001';
      end if;
      return new;
    end if;
    if new.ended_at is null then
      new.ended_by_user_id := null;
      return new;
    end if;
    select * into v_property from public.properties p where p.company_id = new.company_id and p.id = new.property_id;
    if v_property.status = 'archived' then
      raise exception 'Property % is archived. Restore it before unassigning its units.', v_property.name using errcode = 'P0001';
    end if;
    if (select auth.uid()) is not null then
      new.ended_by_user_id := (select auth.uid());
      new.ended_at := now();
    end if;
    return new;
  end if;

  -- INSERT: a new assignment is current.
  if new.ended_at is not null or new.ended_by_user_id is not null then
    raise exception 'A new assignment is current; it cannot start ended.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.tenants t where t.company_id = new.company_id and t.id = new.tenant_id) then
    raise exception 'The tenant is not in this workspace' using errcode = 'P0002';
  end if;
  -- Locks the unit (every caller, not only assign_tenant_to_unit) so this check and a lease of the unit being added or
  -- becoming active (private.guard_lease_unit_assignment, which locks it too) run one after the other, and each sees
  -- the other's committed row.
  select * into v_unit from public.units u where u.company_id = new.company_id and u.id = new.unit_id for update;
  if not found then
    raise exception 'The unit is not in this workspace' using errcode = 'P0002';
  end if;
  new.property_id := v_unit.property_id;

  select * into v_property from public.properties p where p.company_id = new.company_id and p.id = v_unit.property_id;
  if v_property.status = 'archived' then
    raise exception 'Property % is archived. Restore it before assigning its units.', v_property.name using errcode = 'P0001';
  end if;

  v_holder := private.unit_held_by_another_tenant(new.company_id, new.unit_id, new.tenant_id);
  if v_holder is not null then
    raise exception 'Unit % is %. %', v_unit.unit_number, v_holder,
      case when v_holder like 'let to %' then 'It cannot be assigned to another tenant while that lease is in place.'
           else 'Unassign it before assigning it to another tenant.' end
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.unit_tenant_assignments a
    where a.company_id = new.company_id and a.unit_id = new.unit_id and a.ended_at is null
  ) then
    raise exception 'Unit % is already assigned to this tenant.', v_unit.unit_number using errcode = 'P0001';
  end if;

  if (select auth.uid()) is not null then
    new.assigned_by_user_id := (select auth.uid());
    new.assigned_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_unit_tenant_assignment() from public, anon, authenticated;

create trigger guard_change before insert or update on public.unit_tenant_assignments
  for each row execute function private.guard_unit_tenant_assignment();

-- --------------------------------------------------------------------------- the unit follows its assignment

-- Assigning marks the unit occupied; unassigning returns it to vacant unless a lease keeps it occupied (its current
-- lease, or an active or expiring lease). Either way the unit's current tenant is derived again.
create function private.sync_unit_with_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.units u set occupancy_status = 'occupied'
    where u.company_id = new.company_id and u.id = new.unit_id;
  elsif old.ended_at is null and new.ended_at is not null then
    update public.units u
    set occupancy_status = case
      when u.current_lease_id is not null
        or exists (
          select 1 from public.leases l
          where l.company_id = u.company_id and l.unit_id = u.id and l.status in ('active', 'expiring')
        )
        then u.occupancy_status
      else 'vacant'::public.occupancy_status
    end
    where u.company_id = new.company_id and u.id = new.unit_id;
  end if;
  return null;
end;
$$;
revoke all on function private.sync_unit_with_assignment() from public, anon, authenticated;

create trigger sync_unit after insert or update on public.unit_tenant_assignments
  for each row execute function private.sync_unit_with_assignment();

-- --------------------------------------------------------------------------- audit

create function private.audit_unit_tenant_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_unit text;
  v_property text;
  v_ended constant boolean := tg_op = 'UPDATE' and old.ended_at is null and new.ended_at is not null;
begin
  if tg_op = 'UPDATE' and not v_ended then
    return null;
  end if;
  select t.trading_name into v_tenant from public.tenants t where t.company_id = new.company_id and t.id = new.tenant_id;
  select u.unit_number into v_unit from public.units u where u.company_id = new.company_id and u.id = new.unit_id;
  select p.name into v_property from public.properties p where p.company_id = new.company_id and p.id = new.property_id;

  if v_ended then
    perform private.write_audit(
      new.company_id, 'update', 'unit', new.unit_id,
      format('%s unassigned from unit %s in %s', v_tenant, v_unit, v_property),
      jsonb_build_array(
        private.field_change('tenant', v_tenant, null::text),
        private.field_change('tenantId', new.tenant_id, null::uuid),
        private.field_change('propertyId', new.property_id, new.property_id),
        private.field_change('assignmentId', new.id, new.id)
      )
    );
  else
    perform private.write_audit(
      new.company_id, 'update', 'unit', new.unit_id,
      format('%s assigned to unit %s in %s', v_tenant, v_unit, v_property),
      jsonb_build_array(
        private.field_change('tenant', null::text, v_tenant),
        private.field_change('tenantId', null::uuid, new.tenant_id),
        private.field_change('propertyId', new.property_id, new.property_id),
        private.field_change('assignmentId', null::uuid, new.id)
      )
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_unit_tenant_assignment() from public, anon, authenticated;

create trigger audit_change after insert or update on public.unit_tenant_assignments
  for each row execute function private.audit_unit_tenant_assignment();

-- --------------------------------------------------------------------------- leases of an assigned unit

-- Every role: a lease of an assigned unit is for the assigned tenant, when it is added, when its tenant or unit
-- changes, and when it becomes active or expiring. Fires after guard_change (names fire in order).
create function private.guard_lease_unit_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned record;
begin
  if not (
    tg_op = 'INSERT'
    or new.tenant_id is distinct from old.tenant_id
    or new.unit_id is distinct from old.unit_id
    or (new.status in ('active', 'expiring') and old.status not in ('active', 'expiring'))
  ) then
    return new;
  end if;

  -- Waits for an assignment of the unit being written in another transaction (guard_unit_tenant_assignment locks the
  -- unit), so the check below sees it once committed.
  perform 1 from public.units u where u.company_id = new.company_id and u.id = new.unit_id for no key update;

  select u.unit_number, t.trading_name into v_assigned
  from public.unit_tenant_assignments a
  join public.units u on u.company_id = a.company_id and u.id = a.unit_id
  join public.tenants t on t.company_id = a.company_id and t.id = a.tenant_id
  where a.company_id = new.company_id and a.unit_id = new.unit_id and a.ended_at is null and a.tenant_id <> new.tenant_id;
  if found then
    raise exception 'Unit % is assigned to %, so its lease must be for %. Unassign the unit first to let it to another tenant.',
      v_assigned.unit_number, v_assigned.trading_name, v_assigned.trading_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_lease_unit_assignment() from public, anon, authenticated;

create trigger guard_unit_assignment before insert or update on public.leases
  for each row execute function private.guard_lease_unit_assignment();

-- --------------------------------------------------------------------------- assign and unassign

create function public.assign_tenant_to_unit(p_company_id uuid, p_tenant_id uuid, p_unit_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.can_write(p_company_id) then
    raise exception 'Only company admins and property managers can assign tenants to units' using errcode = '42501';
  end if;

  -- Serialises assignments of the same unit.
  perform 1 from public.units u where u.company_id = p_company_id and u.id = p_unit_id for update;
  if not found then
    raise exception 'The unit is not in this workspace' using errcode = 'P0002';
  end if;

  -- Assigning the unit to the tenant who already holds it changes nothing.
  select a.id into v_id from public.unit_tenant_assignments a
  where a.company_id = p_company_id and a.unit_id = p_unit_id and a.tenant_id = p_tenant_id and a.ended_at is null;
  if found then
    return v_id;
  end if;

  insert into public.unit_tenant_assignments (company_id, unit_id, tenant_id)
  values (p_company_id, p_unit_id, p_tenant_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.assign_tenant_to_unit(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_tenant_to_unit(uuid, uuid, uuid) to authenticated;
comment on function public.assign_tenant_to_unit(uuid, uuid, uuid) is
  'A company writer assigns tenant p_tenant_id to unit p_unit_id without a lease and returns the current assignment id '
  '(the existing one when the tenant already holds the unit). The unit becomes occupied. P0002 when the tenant or unit '
  'is not in the company; P0001 (naming who holds it) when the property is archived or the unit is let or assigned to '
  'another tenant. Audited on the unit.';

create function public.end_unit_tenant_assignment(p_company_id uuid, p_assignment_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.can_write(p_company_id) then
    raise exception 'Only company admins and property managers can unassign tenants from units' using errcode = '42501';
  end if;

  update public.unit_tenant_assignments a set ended_at = now()
  where a.company_id = p_company_id and a.id = p_assignment_id and a.ended_at is null
  returning a.id into v_id;
  if found then
    return v_id;
  end if;
  if exists (select 1 from public.unit_tenant_assignments a where a.company_id = p_company_id and a.id = p_assignment_id) then
    raise exception 'This assignment has already ended.' using errcode = 'P0001';
  end if;
  raise exception 'The assignment is not in this workspace' using errcode = 'P0002';
end;
$$;
revoke all on function public.end_unit_tenant_assignment(uuid, uuid) from public, anon;
grant execute on function public.end_unit_tenant_assignment(uuid, uuid) to authenticated;
comment on function public.end_unit_tenant_assignment(uuid, uuid) is
  'A company writer ends a current assignment (kept as history). The unit returns to vacant unless a lease keeps it '
  'occupied. P0002 when the assignment is not in the company; P0001 when it has already ended or the property is '
  'archived. Audited on the unit.';
