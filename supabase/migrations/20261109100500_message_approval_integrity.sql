-- Integrity of tenant message approvals, enforced in the database.
--
-- Product rule (PRD 6.6): a tenant message is sent only after an authorised property manager
-- (company_admin or property_manager) approved it. Any writer may approve, including the writer who
-- requested the approval, so single-manager companies can operate.
--
-- The writers_request / writers_decide policies only check that the caller is a company writer, and
-- stamp_decision records whoever made the decision. Without this guard a signed-in writer could skip
-- the explicit approval step by inserting a request that is already decided, carry an approval over
-- to another message, or rewrite who approved.
--
-- For end users (the authenticated role):
--   * an approval request is created pending, never already decided;
--   * a request cannot be moved to another message or requester, which would carry an approval
--     granted for one message over to another;
--   * who decided, and when, is only ever recorded by a decision (see stamp_decision), never
--     edited afterwards.
--
-- The service role (backend jobs) and the database owner (seed loader, migrations) are not
-- restricted.

create function private.guard_message_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.decision <> 'pending' or new.decided_by_user_id is not null or new.decided_at is not null then
      raise exception 'an approval request must be created pending; a writer then decides it'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.communication_id is distinct from old.communication_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id then
    raise exception 'an approval request cannot be moved to another message or requester'
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

revoke all on function private.guard_message_approval() from public;

-- Named to sort before stamp_decision, so the guard sees the caller's values before they are stamped.
create trigger guard_approval_integrity before insert or update on public.message_approvals
  for each row execute function private.guard_message_approval();
