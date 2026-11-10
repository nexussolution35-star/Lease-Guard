-- Who may change company memberships.
--
-- * INSERT: service role only (the invitation worker and platform tooling create memberships from an
--   invitation). An admin can no longer enrol any user id directly, which bypassed the invite and
--   consent flow and exposed that user's private contact details through profile visibility.
-- * UPDATE: a company_admin may change another member's role (never their own row); every user may
--   change is_default on their own memberships only (workspace opened on login). Nothing else.
-- * DELETE: a company_admin may remove another member, not themselves.
-- * A company always keeps at least one ACTIVE company_admin: demoting or removing the last one is
--   refused, for signed-in users and the service role alike. Cascades from deleting the company (or
--   the auth user, run by the table owner) are not blocked.

revoke insert, update, delete on public.company_users from authenticated;
grant update (role, is_default) on public.company_users to authenticated;
grant delete on public.company_users to authenticated;

drop policy admins_insert on public.company_users;
drop policy admins_update on public.company_users;
drop policy admins_delete on public.company_users;

-- One policy for both cases (admins on their company's rows, everyone on their own rows), so the
-- planner evaluates a single permissive policy.
create policy admins_or_own_update on public.company_users for update to authenticated
  using (
    company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
    or user_id = (select auth.uid())
  )
  with check (
    company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
    or user_id = (select auth.uid())
  );
create policy admins_delete on public.company_users for delete to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

-- Column-level rules for signed-in users (the update policy admits both admins and row owners, so
-- the trigger decides which columns each may change).
create function private.guard_membership_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.user_id = (select auth.uid()) then
      raise exception 'you cannot remove yourself from a company; another company admin must do it'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if new.role is distinct from old.role then
    if old.user_id = (select auth.uid()) then
      raise exception 'you cannot change your own role; another company admin must do it'
        using errcode = '42501';
    end if;
    if not private.has_company_role(old.company_id, '{company_admin}') then
      raise exception 'only a company admin can change member roles'
        using errcode = '42501';
    end if;
  end if;
  if new.is_default is distinct from old.is_default and old.user_id <> (select auth.uid()) then
    raise exception 'is_default is chosen by each user for their own memberships'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_membership_change() from public;

create trigger guard_membership_change before update or delete on public.company_users
  for each row execute function private.guard_membership_change();

-- True when taking the company_admin role away from p_user_id (already applied by the statement)
-- leaves the company without an active company_admin. Locks the company row (FOR NO KEY UPDATE, which
-- does not block child-row foreign key checks) so two concurrent removals are serialised and cannot
-- both pass. SECURITY DEFINER: it must see every membership and profile regardless of the caller's RLS
-- (the removed member is no longer visible to the caller at this point).
create function private.leaves_company_without_admin(p_company_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.companies c where c.id = p_company_id for no key update;
  if not found then
    return false; -- the company itself is being deleted
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.status = 'active') then
    return false; -- an inactive admin did not count
  end if;
  return not exists (
    select 1
    from public.company_users cu
    join public.profiles p on p.id = cu.user_id
    where cu.company_id = p_company_id and cu.role = 'company_admin' and p.status = 'active'
  );
end;
$$;
revoke all on function private.leaves_company_without_admin(uuid, uuid) from public;
grant execute on function private.leaves_company_without_admin(uuid, uuid) to authenticated, service_role;

-- AFTER trigger: sees every row the statement changed, so a multi-row update cannot remove all admins.
create function private.keep_active_company_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'service_role') then
    return null;
  end if;
  if old.role = 'company_admin'
     and (tg_op = 'DELETE' or new.role <> 'company_admin')
     and private.leaves_company_without_admin(old.company_id, old.user_id) then
    raise exception 'a company must keep at least one active company admin; make another member company admin first'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;
revoke all on function private.keep_active_company_admin() from public;

create trigger keep_active_company_admin after update of role or delete on public.company_users
  for each row execute function private.keep_active_company_admin();
