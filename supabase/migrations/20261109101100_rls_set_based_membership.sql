-- Row Level Security evaluated once per statement instead of once per row. Same semantics.
--
-- Every company-scoped policy called a SECURITY DEFINER helper with the row's own column, e.g.
-- private.is_company_member(company_id). Because the argument changes per row, Postgres cannot hoist
-- the call into an InitPlan, and a SECURITY DEFINER function is never inlined, so the
-- company_users + profiles lookup ran for every candidate row (and for every row counted by
-- count:'exact' on each list page).
--
-- The new helpers return the caller's company ids once; policies compare the row's column with
-- `= any ((select helper())::uuid[])`, which the planner runs as a single InitPlan. The `::uuid[]`
-- cast is required: inside `= any (...)` a bare `(select ...)` parses as a subquery, not an array.
--
-- Semantics are unchanged:
--   is_company_member(c)       <=>  c = any (member_company_ids())          (active profile, any role)
--   has_company_role(c, roles) <=>  c = any (company_ids_with_role(roles))  (active profile, role in roles)
--   can_write(c)               <=>  c = any (company_ids_with_role('{company_admin,property_manager}'))
--   shares_company_with(u)     <=>  u = any (colleague_user_ids())          (active caller)
-- NULL behaves the same: `NULL = any (...)` is NULL, which denies, exactly like is_company_member(NULL)
-- returning false (this matters for storage_company_id() of a path without a uuid prefix).
--
-- The per-row helpers stay: triggers and the backend refer to them.

create function private.member_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cu.company_id), '{}')
  from public.company_users cu
  join public.profiles p on p.id = cu.user_id
  where cu.user_id = (select auth.uid())
    and p.status = 'active'
$$;

create function private.company_ids_with_role(p_roles public.user_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cu.company_id), '{}')
  from public.company_users cu
  join public.profiles p on p.id = cu.user_id
  where cu.user_id = (select auth.uid())
    and p.status = 'active'
    and cu.role = any (p_roles)
$$;

-- Everyone who shares a company with the caller, while the caller's profile is active
-- (the set form of shares_company_with, see 20261109100600).
create function private.colleague_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct theirs.user_id), '{}')
  from public.company_users mine
  join public.profiles me on me.id = mine.user_id
  join public.company_users theirs on theirs.company_id = mine.company_id
  where mine.user_id = (select auth.uid())
    and me.status = 'active'
$$;

revoke all on function private.member_company_ids() from public;
revoke all on function private.company_ids_with_role(public.user_role[]) from public;
revoke all on function private.colleague_user_ids() from public;
grant execute on function private.member_company_ids() to authenticated, service_role;
grant execute on function private.company_ids_with_role(public.user_role[]) to authenticated, service_role;
grant execute on function private.colleague_user_ids() to authenticated, service_role;

-- --------------------------------------------------------------------------- standard company-owned tables

do $$
declare
  t text;
  member text := 'company_id = any ((select private.member_company_ids())::uuid[])';
  writer text := 'company_id = any ((select private.company_ids_with_role(''{company_admin,property_manager}''))::uuid[])';
begin
  foreach t in array array[
    'properties', 'units', 'tenants', 'leases', 'lease_bank_guarantees', 'lease_documents',
    'statements', 'statement_line_items', 'statement_extractions', 'statement_extraction_fields',
    'monitoring_rules', 'monitoring_events', 'payment_arrangements', 'arrangement_installments',
    'message_templates'
  ] loop
    execute format('alter policy members_read on public.%I using (%s)', t, member);
    execute format('alter policy writers_insert on public.%I with check (%s)', t, writer);
    execute format('alter policy writers_update on public.%I using (%s) with check (%s)', t, writer, writer);
    execute format('alter policy writers_delete on public.%I using (%s)', t, writer);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------- communications and approvals

alter policy members_read on public.communications
  using (company_id = any ((select private.member_company_ids())::uuid[]));
alter policy writers_insert on public.communications
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));
alter policy writers_update on public.communications
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));

alter policy members_read on public.message_approvals
  using (company_id = any ((select private.member_company_ids())::uuid[]));
alter policy writers_request on public.message_approvals
  with check (
    company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
    and requested_by_user_id = (select auth.uid())
  );
alter policy writers_decide on public.message_approvals
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[]));

-- --------------------------------------------------------------------------- companies and membership

alter policy members_read on public.companies
  using (id = any ((select private.member_company_ids())::uuid[]));
alter policy admins_update on public.companies
  using (id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]))
  with check (id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

alter policy members_read on public.company_users
  using (company_id = any ((select private.member_company_ids())::uuid[]));
alter policy admins_insert on public.company_users
  with check (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));
alter policy admins_update on public.company_users
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));
alter policy admins_delete on public.company_users
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

alter policy members_read on public.whatsapp_accounts
  using (company_id = any ((select private.member_company_ids())::uuid[]));
alter policy admins_insert on public.whatsapp_accounts
  with check (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));
alter policy admins_update on public.whatsapp_accounts
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]))
  with check (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));
alter policy admins_delete on public.whatsapp_accounts
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

alter policy self_or_colleague_read on public.profiles
  using (id = (select auth.uid()) or id = any ((select private.colleague_user_ids())::uuid[]));

-- --------------------------------------------------------------------------- notifications and audit

alter policy own_read on public.notifications
  using (user_id = (select auth.uid()) and company_id = any ((select private.member_company_ids())::uuid[]));
alter policy own_mark_read on public.notifications
  using (user_id = (select auth.uid()) and company_id = any ((select private.member_company_ids())::uuid[]))
  with check (user_id = (select auth.uid()) and company_id = any ((select private.member_company_ids())::uuid[]));

alter policy auditors_read on public.audit_logs
  using (company_id = any ((select private.company_ids_with_role('{company_admin,property_manager,read_only}'))::uuid[]));
alter policy members_append_own on public.audit_logs
  with check (company_id = any ((select private.member_company_ids())::uuid[]) and actor_user_id = (select auth.uid()));

-- --------------------------------------------------------------------------- storage objects

alter policy leaseguard_members_read on storage.objects
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.storage_company_id(name) = any ((select private.member_company_ids())::uuid[])
  );
alter policy leaseguard_writers_insert on storage.objects
  with check (
    bucket_id in ('statements', 'lease-documents')
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
alter policy leaseguard_writers_update on storage.objects
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  )
  with check (
    bucket_id in ('statements', 'lease-documents')
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
alter policy leaseguard_writers_delete on storage.objects
  using (
    bucket_id in ('statements', 'lease-documents')
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])
  );
