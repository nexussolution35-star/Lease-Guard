-- What signed-in writers may do to messages and approvals. The delivery worker (service role) and
-- the database owner are not restricted.
--
-- 1. Delivery state is recorded only by the delivery worker. Writers had table-wide INSERT/UPDATE on
--    communications, so they could mark an approved message delivered (dropping it out of the
--    worker's sendable set while the UI said it was sent), set sent_at / external_message_id, or
--    insert fake inbound replies. Column grants now leave out the delivery columns, and a trigger
--    limits writers to creating outbound drafts / approval requests and to these status moves:
--      draft            -> pending_approval
--      pending_approval -> approved | rejected                     (the API's decision)
--      rejected         -> draft | pending_approval                (only if never approved)
--      approved | queued | failed -> rejected                      (stop a message)
-- 2. An approval covers the message as it was approved (closes the bypass of 20261109100800, where
--    approved -> rejected -> edit -> approved re-released edited content under the old approval).
--    Once a message has ever been approved (an approved approval exists, or its status is in the
--    approved family), writers cannot change its content, recipient or links, cannot return it to
--    draft / pending_approval, cannot release it again from rejected, and cannot open a new approval
--    request on it. A correction is a new message.
-- 3. A decided approval is final for writers: it cannot be re-decided.
-- 4. The approval guard checks the governing approval (the open request, else the latest by
--    requested_at, id: the same rule as currentApproval in the backend) instead of any approved row.

-- --------------------------------------------------------------------------- column privileges

revoke insert, update on public.communications from authenticated;
grant insert (
  company_id, channel, direction, message_type, recipient_type, tenant_id, owner_user_id, property_id,
  lease_id, statement_id, arrangement_id, template_id, counterparty_number, company_number, body,
  attachment_file_name, attachment_storage_path, attachment_mime_type, attachment_size_bytes,
  attachment_sha256, status, created_by_user_id
) on public.communications to authenticated;
grant update (
  channel, direction, message_type, recipient_type, tenant_id, owner_user_id, property_id,
  lease_id, statement_id, arrangement_id, template_id, counterparty_number, company_number, body,
  attachment_file_name, attachment_storage_path, attachment_mime_type, attachment_size_bytes,
  attachment_sha256, status
) on public.communications to authenticated;

-- --------------------------------------------------------------------------- helpers

-- True when the message was ever approved. Not SECURITY DEFINER: it runs inside invoker triggers
-- whose current_user check must see the caller; writers can read their company's approvals.
create function private.message_was_approved(p_company_id uuid, p_communication_id uuid, p_status public.delivery_status)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('approved', 'queued', 'sent', 'delivered', 'read', 'failed')
    or exists (
      select 1 from public.message_approvals a
      where a.company_id = p_company_id and a.communication_id = p_communication_id and a.decision = 'approved'
    )
$$;
revoke all on function private.message_was_approved(uuid, uuid, public.delivery_status) from public;
grant execute on function private.message_was_approved(uuid, uuid, public.delivery_status) to authenticated, service_role;

-- --------------------------------------------------------------------------- communications guard

create function private.guard_message_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  was_approved boolean;
  allowed boolean;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.direction <> 'outbound' or new.status not in ('draft', 'pending_approval') then
      raise exception 'a message is created as an outbound draft or approval request; delivery states are recorded by the delivery worker'
        using errcode = '42501';
    end if;
    return new;
  end if;

  was_approved := private.message_was_approved(old.company_id, old.id, old.status);

  if was_approved
     and (new.channel, new.direction, new.message_type, new.recipient_type, new.tenant_id, new.owner_user_id,
          new.property_id, new.lease_id, new.statement_id, new.arrangement_id,
          new.counterparty_number, new.company_number, new.body, new.template_id,
          new.attachment_file_name, new.attachment_storage_path, new.attachment_mime_type,
          new.attachment_size_bytes, new.attachment_sha256)
         is distinct from
         (old.channel, old.direction, old.message_type, old.recipient_type, old.tenant_id, old.owner_user_id,
          old.property_id, old.lease_id, old.statement_id, old.arrangement_id,
          old.counterparty_number, old.company_number, old.body, old.template_id,
          old.attachment_file_name, old.attachment_storage_path, old.attachment_mime_type,
          old.attachment_size_bytes, old.attachment_sha256) then
    raise exception 'the content and recipient of a message that was approved cannot be changed; create a new message instead'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    allowed := case
      when old.status = 'draft' then new.status = 'pending_approval'
      when old.status = 'pending_approval' then new.status in ('approved', 'rejected')
      when old.status = 'rejected' then not was_approved and new.status in ('draft', 'pending_approval')
      when old.status in ('approved', 'queued', 'failed') then new.status = 'rejected'
      else false
    end;
    if not allowed then
      if was_approved and old.status = 'rejected' then
        raise exception 'a message that was approved and then stopped cannot be released again; create a new message instead'
          using errcode = '42501';
      end if;
      raise exception 'a signed-in user cannot move a message from % to %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.guard_message_write() from public;

drop trigger guard_approved_content on public.communications;
drop function private.guard_approved_message_content();

create trigger guard_message_write before insert or update on public.communications
  for each row execute function private.guard_message_write();

-- --------------------------------------------------------------------------- approvals guard

create or replace function private.guard_message_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  msg_status public.delivery_status;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.decision <> 'pending' or new.decided_by_user_id is not null or new.decided_at is not null then
      raise exception 'an approval request must be created pending; a writer then decides it'
        using errcode = '42501';
    end if;
    select c.status into msg_status from public.communications c
    where c.company_id = new.company_id and c.id = new.communication_id;
    if found and private.message_was_approved(new.company_id, new.communication_id, msg_status) then
      raise exception 'a message that was approved cannot be submitted for approval again; create a new message instead'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.communication_id is distinct from old.communication_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id then
    raise exception 'an approval request cannot be moved to another message or requester'
      using errcode = '42501';
  end if;

  if old.decision <> 'pending' and new.decision is distinct from old.decision then
    raise exception 'a decided approval is final; request a new approval on a new message instead'
      using errcode = '42501';
  end if;

  if new.decision is not distinct from old.decision
     and (new.decided_by_user_id is distinct from old.decided_by_user_id
          or new.decided_at is distinct from old.decided_at) then
    raise exception 'the approver and decision time are recorded by the decision and cannot be edited'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------- governing approval

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
     and msg.status in ('approved', 'queued', 'sent', 'delivered', 'read')
     and (select c.require_approval_for_tenant_messages from public.companies c where c.id = msg.company_id) then
    -- The open request if there is one, else the latest decision (currentApproval in the backend).
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
