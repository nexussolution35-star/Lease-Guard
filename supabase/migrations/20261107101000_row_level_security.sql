-- Row Level Security and table privileges.
--
-- Model: a signed-in user sees rows of companies they are an active member of. company_admin and
-- property_manager write company data; property_owner and read_only only read. The anon role has
-- no privileges on any LeaseGuard table. service_role (backend workers only) bypasses RLS and must
-- filter by company_id itself.

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Every public table has RLS enabled, including the backend-only job_runs (no policies: closed).
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------- standard company-owned tables
-- Members read; company_admin / property_manager insert, update and delete.

do $$
declare
  t text;
begin
  foreach t in array array[
    'properties', 'units', 'tenants', 'leases', 'lease_bank_guarantees', 'lease_documents',
    'statements', 'statement_line_items', 'statement_extractions', 'statement_extraction_fields',
    'monitoring_rules', 'monitoring_events', 'payment_arrangements', 'arrangement_installments',
    'message_templates'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy members_read on public.%I for select to authenticated using (private.is_company_member(company_id))', t);
    execute format(
      'create policy writers_insert on public.%I for insert to authenticated with check (private.can_write(company_id))', t);
    execute format(
      'create policy writers_update on public.%I for update to authenticated using (private.can_write(company_id)) with check (private.can_write(company_id))', t);
    execute format(
      'create policy writers_delete on public.%I for delete to authenticated using (private.can_write(company_id))', t);
  end loop;
end;
$$;

-- Communications are a delivery record: writers create and update them, nobody deletes them.
grant select, insert, update on public.communications to authenticated;
create policy members_read on public.communications for select to authenticated
  using (private.is_company_member(company_id));
create policy writers_insert on public.communications for insert to authenticated
  with check (private.can_write(company_id));
create policy writers_update on public.communications for update to authenticated
  using (private.can_write(company_id)) with check (private.can_write(company_id));

-- Approvals: requested as yourself, decided by a writer, never deleted.
grant select, insert, update on public.message_approvals to authenticated;
create policy members_read on public.message_approvals for select to authenticated
  using (private.is_company_member(company_id));
create policy writers_request on public.message_approvals for insert to authenticated
  with check (private.can_write(company_id) and requested_by_user_id = (select auth.uid()));
create policy writers_decide on public.message_approvals for update to authenticated
  using (private.can_write(company_id)) with check (private.can_write(company_id));

-- --------------------------------------------------------------------------- companies and membership

grant select, update on public.companies to authenticated;
create policy members_read on public.companies for select to authenticated
  using (private.is_company_member(id));
create policy admins_update on public.companies for update to authenticated
  using (private.has_company_role(id, '{company_admin}')) with check (private.has_company_role(id, '{company_admin}'));

grant select, insert, update, delete on public.company_users to authenticated;
create policy members_read on public.company_users for select to authenticated
  using (private.is_company_member(company_id));
create policy admins_insert on public.company_users for insert to authenticated
  with check (private.has_company_role(company_id, '{company_admin}'));
create policy admins_update on public.company_users for update to authenticated
  using (private.has_company_role(company_id, '{company_admin}'))
  with check (private.has_company_role(company_id, '{company_admin}'));
create policy admins_delete on public.company_users for delete to authenticated
  using (private.has_company_role(company_id, '{company_admin}'));

grant select, insert, update, delete on public.whatsapp_accounts to authenticated;
create policy members_read on public.whatsapp_accounts for select to authenticated
  using (private.is_company_member(company_id));
create policy admins_insert on public.whatsapp_accounts for insert to authenticated
  with check (private.has_company_role(company_id, '{company_admin}'));
create policy admins_update on public.whatsapp_accounts for update to authenticated
  using (private.has_company_role(company_id, '{company_admin}'))
  with check (private.has_company_role(company_id, '{company_admin}'));
create policy admins_delete on public.whatsapp_accounts for delete to authenticated
  using (private.has_company_role(company_id, '{company_admin}'));

-- Profiles: visible to yourself and to people you share a company with. Users edit only their own
-- contact details; status and email are managed by the backend.
grant select on public.profiles to authenticated;
grant update (full_name, phone, whatsapp_number, job_title) on public.profiles to authenticated;
create policy self_or_colleague_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_company_with(id));
create policy self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --------------------------------------------------------------------------- notifications, audit, jobs

-- Notifications are personal. They are created by the backend; users only mark them read.
grant select on public.notifications to authenticated;
grant update (read, read_at) on public.notifications to authenticated;
create policy own_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy own_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

-- Audit log: readable by roles with viewAuditLogs (not property_owner). Members may append entries
-- for their own actions; nobody may update or delete (privileges withheld, trigger enforced).
grant select, insert on public.audit_logs to authenticated;
create policy auditors_read on public.audit_logs for select to authenticated
  using (private.has_company_role(company_id, '{company_admin,property_manager,read_only}'));
create policy members_append_own on public.audit_logs for insert to authenticated
  with check (private.is_company_member(company_id) and actor_user_id = (select auth.uid()));

-- job_runs: RLS on, no policies and no grants for anon/authenticated. Backend only.
