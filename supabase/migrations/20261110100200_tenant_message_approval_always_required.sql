-- Every outbound tenant message needs an approved message approval, in every company, always.
--
-- "Tenant communication requires property-manager approval before sending" is a product hard
-- constraint, not a company setting. companies.require_approval_for_tenant_messages made it look like
-- one: the domain honoured it, the backend ignored it (always required) and this guard honoured it, so
-- the three owners of one rule disagreed. The rule now has one shape everywhere: @leaseguard/domain
-- (canSendTenantMessage) owns it, the backend's outbound gate applies it, and this guard is the last
-- line of defence with no switch to turn it off.
--
-- Replaces the 20261109101600 version: identical except that it no longer reads the company column.
-- The governing approval is the open request, else the latest decision (currentApproval in the
-- backend, backend/src/messaging/governing-approval.ts).

create or replace function private.guard_tenant_message_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.communications%rowtype;
  governing public.approval_decision;
begin
  select * into msg from public.communications where id = new.id;
  if not found then
    return null;
  end if;
  if msg.direction = 'outbound'
     and msg.recipient_type = 'tenant'
     and msg.status in ('approved', 'queued', 'sent', 'delivered', 'read') then
    select a.decision into governing
    from public.message_approvals a
    where a.company_id = msg.company_id and a.communication_id = msg.id
    order by (a.decision = 'pending') desc, a.requested_at desc, a.id desc
    limit 1;
    if governing is distinct from 'approved' then
      raise exception 'tenant message % cannot be % without an approved message approval', msg.id, msg.status
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;
-- A trigger function: nobody calls it directly (the trigger runs it as its owner).
revoke all on function private.guard_tenant_message_approval() from public, anon, authenticated;

-- Nothing else reads the column: the guard above was its only database reader, the API never exposed
-- it for writing (20261109101800), and the backend no longer maps it.
alter table public.companies drop column require_approval_for_tenant_messages;
