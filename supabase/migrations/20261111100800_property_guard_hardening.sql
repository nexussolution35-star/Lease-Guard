-- Tightens private.guard_property_change (20261111100700_property_management.sql) after review:
--
-- 1. An archived property is read-only until restored, and restoring makes it active. Before, an edit
--    that also changed the status (archived -> under_development plus a new name) passed the guard,
--    because the read-only rule only applied while the status stayed archived. Now, from archived, the
--    only allowed change is the status alone, to 'active'.
-- 2. The guard is SECURITY DEFINER and runs before Row Level Security's WITH CHECK on INSERT. A writer
--    of one company inserting with another company's id got the guard's manager-role message, which told
--    them whether a user was a company admin or property manager there. A signed-in caller who cannot
--    write the target company is now refused (42501, as RLS would) before anything is looked up.

create or replace function private.guard_property_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Signed-in callers only reach the rules below for a company they can write; the service role and
  -- background jobs (no auth.uid()) are not restricted here.
  if (select auth.uid()) is not null
     and not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'new row violates row-level security policy for table "properties"' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.status = 'archived' then
    raise exception 'A new property cannot start archived' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.status = 'archived' then
    if (to_jsonb(new) - 'updated_at' - 'status') is distinct from (to_jsonb(old) - 'updated_at' - 'status')
       or new.status not in ('archived', 'active') then
      raise exception 'This property is archived. Restore it before changing it.' using errcode = 'P0001';
    end if;
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
