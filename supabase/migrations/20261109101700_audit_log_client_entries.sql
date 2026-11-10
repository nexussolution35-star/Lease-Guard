-- Signed-in users may only record their own session events in the audit log.
--
-- Any member (including read_only and property_owner) could append arbitrary, back-dated entries
-- such as 'Lease terms verified', which the append-only trigger then made permanent. Business actions
-- are written only by the SECURITY DEFINER audit triggers (private.write_audit) and the service role.
-- A signed-in member may still record login, logout and workspace_switch for themselves:
--   * actor_user_id must be the caller (policy members_append_own);
--   * the entity is the caller ('user', auth.uid()) or the row's company ('company', company_id);
--   * changes must be empty; occurred_at and created_at are always the time of the insert.

revoke insert on public.audit_logs from authenticated;
grant insert (company_id, actor_user_id, action, entity_type, entity_id, summary, changes, occurred_at)
  on public.audit_logs to authenticated;

create function private.guard_client_audit_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.action not in ('login', 'logout', 'workspace_switch') then
    raise exception 'signed-in users can only record login, logout and workspace switches; % is recorded by the system', new.action
      using errcode = '42501';
  end if;
  if not ((new.entity_type = 'user' and new.entity_id = (select auth.uid()))
          or (new.entity_type = 'company' and new.entity_id = new.company_id)) then
    raise exception 'a session entry is about the signed-in user or the workspace company'
      using errcode = '42501';
  end if;
  if new.changes is not null then
    raise exception 'a session entry carries no field changes'
      using errcode = '42501';
  end if;
  new.occurred_at := now();
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.guard_client_audit_entry() from public;

create trigger guard_client_entry before insert on public.audit_logs
  for each row execute function private.guard_client_audit_entry();
