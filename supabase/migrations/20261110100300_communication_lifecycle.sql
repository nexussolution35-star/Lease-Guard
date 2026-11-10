-- The outbound communication lifecycle: one owner for every status transition of a message.
--
-- Before this migration the transitions were conditional updates in three places (the approve and
-- reject endpoints, the delivery worker, and next the WhatsApp webhook), the guard only checked
-- signed-in users, and "this message may already have been sent" travelled as a free-text prefix on
-- the failure reason that the API parsed back out of BullMQ. Now:
--
-- 1. communications.send_uncertain_since records "may have been sent" as a fact on the message.
-- 2. private.communication_status_transitions is the transition table, and the write guard enforces it
--    for every API role: signed-in users (authenticated) AND the backend (service_role). Only the
--    database owner (migrations, the seed loader, pgTAP fixtures) is not restricted; it can bypass any
--    trigger anyway.
-- 3. One SQL function per transition (below), each atomic and conditional. They are the
--    implementation of the lifecycle module's interface, backend/src/messaging/communication-lifecycle.ts;
--    nothing in the backend writes communications.status directly. For the backend the guard also
--    insists on it: a service-role change of delivery state is accepted only inside the lifecycle
--    function that makes that operation (see private.guard_message_write).
-- 4. A claim is owned. claim_communication returns a token (the claim's send_uncertain_since); only the
--    holder of that token may hand the claim back or record that its send certainly did not happen.
--    Anyone else who fails a claimed message can only keep "may have been sent": another run's send
--    may be in flight, and only that run knows its outcome.
--
-- State machine (operation, who):
--   draft            -> pending_approval               submit           user
--   pending_approval -> approved | rejected            decide           user  (decide_communication)
--   rejected         -> draft | pending_approval       reopen           user  (only if never approved)
--   approved | queued | failed -> rejected             stop             user
--   approved         -> queued                         claim            system (claim_communication)
--   queued           -> approved                       release          system (release_communication_claim; claim holder)
--   queued | failed | rejected -> sent                 record_sent      system (record_communication_sent;
--                                                                       only while the send is uncertain, with the id)
--   approved | queued -> failed                        record_failed    system (record_communication_failed;
--                                                                       clearing the fact on queued: claim holder)
--   sent -> delivered | read | failed, delivered -> read   provider_status  system (record_communication_provider_status)
--   received (inbound) never changes status.

-- ------------------------------------------------------------------ "may have been sent" as a fact

-- Set when a delivery run claims the message (the send is about to start) and kept until the outcome is
-- known: cleared when the send is recorded (it certainly went out) or when the run holding the claim
-- learns WhatsApp certainly refused it (it releases the claim, or records the failure as not sent).
-- The value is also the claim's token: the claim sets it from clock_timestamp(), and two claims of one
-- message are at least a WhatsApp round trip apart, so it names one claim. Non-null therefore means "WhatsApp
-- may have accepted this message and we hold no message id for it": it must never be sent again
-- automatically; a person checks the WhatsApp conversation first.
alter table public.communications add column send_uncertain_since timestamptz;
comment on column public.communications.send_uncertain_since is
  'When a send of this message started without a recorded outcome: the message may have reached WhatsApp. Null when nothing was sent, or the send is recorded (status sent and later). Written only by the communication lifecycle functions.';

-- Existing rows: a queued message was claimed and its outcome never recorded; a failed one whose reason
-- carries the retired prefixes (backend/src/messaging/delivery-failures.ts) may have been sent.
update public.communications
   set send_uncertain_since = updated_at
 where status = 'queued'
    or (status = 'failed'
        and external_message_id is null
        and (failure_reason like 'Message may have been sent: %' or failure_reason like 'Message sent as %'));

alter table public.communications add constraint communications_send_uncertain_check check (
  -- A claimed message always carries the fact; once a provider id is recorded the outcome is known.
  (status <> 'queued' or send_uncertain_since is not null)
  and (send_uncertain_since is null or (status in ('queued', 'failed', 'rejected') and external_message_id is null))
);

-- ------------------------------------------------------------------ transition table

create table private.communication_status_transitions (
  from_status public.delivery_status not null,
  to_status public.delivery_status not null,
  operation text not null,
  -- 'user': a signed-in company writer (authenticated). 'system': the backend (service_role).
  actor text not null check (actor in ('user', 'system')),
  primary key (from_status, to_status)
);
comment on table private.communication_status_transitions is
  'Allowed communications.status moves, the lifecycle operation that makes each, and who may make it. Enforced by private.guard_message_write for every API role.';
revoke all on private.communication_status_transitions from public, anon, authenticated, service_role;

insert into private.communication_status_transitions (from_status, to_status, operation, actor) values
  ('draft',            'pending_approval', 'submit',          'user'),
  ('pending_approval', 'approved',         'decide',          'user'),
  ('pending_approval', 'rejected',         'decide',          'user'),
  ('rejected',         'draft',            'reopen',          'user'),
  ('rejected',         'pending_approval', 'reopen',          'user'),
  ('approved',         'rejected',         'stop',            'user'),
  ('queued',           'rejected',         'stop',            'user'),
  ('failed',           'rejected',         'stop',            'user'),
  ('approved',         'queued',           'claim',           'system'),
  ('queued',           'approved',         'release',         'system'),
  ('queued',           'sent',             'record_sent',     'system'),
  -- A send that was still in flight when another run gave up on it, or a person stopped the message:
  -- WhatsApp accepted it, so the truth is recorded.
  ('failed',           'sent',             'record_sent',     'system'),
  ('rejected',         'sent',             'record_sent',     'system'),
  ('approved',         'failed',           'record_failed',   'system'),
  ('queued',           'failed',           'record_failed',   'system'),
  ('sent',             'delivered',        'provider_status', 'system'),
  -- Meta may skip "delivered" when the message is read immediately.
  ('sent',             'read',             'provider_status', 'system'),
  ('delivered',        'read',             'provider_status', 'system'),
  ('sent',             'failed',           'provider_status', 'system');

-- The guard runs as the writing role, which cannot read the private table; this reveals only the rule.
create function private.communication_transition(
  p_from public.delivery_status, p_to public.delivery_status, p_actor text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.operation from private.communication_status_transitions t
  where t.from_status = p_from and t.to_status = p_to and t.actor = p_actor
$$;
revoke all on function private.communication_transition(public.delivery_status, public.delivery_status, text) from public, anon;
grant execute on function private.communication_transition(public.delivery_status, public.delivery_status, text) to authenticated, service_role;

-- ------------------------------------------------------------------ write guard, for every API role

-- Replaces the 20261109101600 version, which returned early for anything but a signed-in user. The
-- signed-in rules are unchanged (column grants still keep delivery columns out of their reach); the
-- backend is now held to the same transition table, the same content lock and the delivery-fact rules.
--
-- The backend's delivery state is written only by the lifecycle functions below. The service role has
-- table UPDATE (it needs it for other columns), so the guard cannot tell a function's write from a
-- direct one by role; each function instead names its operation in the transaction-local setting
-- leaseguard.communication_lifecycle around its one write, and the guard accepts a service-role change
-- of status or delivery columns only when that setting names the operation the change is. The Data API
-- exposes no way to set it, so through the API only the functions can. It is a guard against a
-- backend writing around the lifecycle by mistake, not a boundary against a hostile service role.
create or replace function private.guard_message_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor text := case current_user
    when 'authenticated' then 'user'
    when 'anon' then 'user'
    when 'service_role' then 'system'
  end;
  was_approved boolean;
  operation text;
  lifecycle_operation text := nullif(current_setting('leaseguard.communication_lifecycle', true), '');
begin
  if actor is null then
    -- The database owner: migrations, the seed loader and test fixtures.
    return new;
  end if;

  if tg_op = 'INSERT' then
    if actor = 'user' and (new.direction <> 'outbound' or new.status not in ('draft', 'pending_approval')) then
      raise exception 'a message is created as an outbound draft or approval request; delivery states are recorded by the delivery worker'
        using errcode = '42501';
    end if;
    if actor = 'system'
       and not ((new.direction = 'outbound' and new.status in ('draft', 'pending_approval'))
                or (new.direction = 'inbound' and new.status = 'received')) then
      raise exception 'the backend creates outbound drafts and approval requests, or received inbound messages; delivery states are recorded through the communication lifecycle'
        using errcode = '42501';
    end if;
    if new.direction = 'outbound'
       and (new.external_message_id is not null or new.sent_at is not null or new.delivered_at is not null
            or new.read_at is not null or new.failure_reason is not null or new.send_uncertain_since is not null) then
      raise exception 'a new outbound message carries no delivery state'
        using errcode = '42501';
    end if;
    return new;
  end if;

  was_approved := private.message_was_approved(old.company_id, old.id, old.status);

  -- An approval covers the message as it was approved, for every writer.
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

  if old.external_message_id is not null and new.external_message_id is distinct from old.external_message_id then
    raise exception 'a recorded WhatsApp message id cannot be changed'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    operation := private.communication_transition(old.status, new.status, actor);
    if operation is null
       or (operation = 'reopen' and was_approved)
       -- Only a message whose send may have happened can be recorded as sent.
       or (operation = 'record_sent' and old.send_uncertain_since is null) then
      if actor = 'user' and was_approved and old.status = 'rejected' then
        raise exception 'a message that was approved and then stopped cannot be released again; create a new message instead'
          using errcode = '42501';
      end if;
      raise exception '% cannot move a message from % to %',
        case actor when 'user' then 'a signed-in user' else 'the backend' end, old.status, new.status
        using errcode = '42501';
    end if;
    if actor = 'system' and lifecycle_operation is distinct from operation then
      raise exception 'the backend moves a message from % to % only through the communication lifecycle (%)',
        old.status, new.status, operation
        using errcode = '42501';
    end if;
    if new.external_message_id is distinct from old.external_message_id and operation <> 'record_sent' then
      raise exception 'the WhatsApp message id is recorded only when the message is recorded as sent'
        using errcode = '42501';
    end if;
    -- "Sent" without the id would erase the possibly-sent fact while losing the one thing that proves
    -- the send and links WhatsApp's status callbacks to the message.
    if operation = 'record_sent' and new.external_message_id is null then
      raise exception 'a message is recorded as sent only with its WhatsApp message id'
        using errcode = '42501';
    end if;
  elsif new.send_uncertain_since is distinct from old.send_uncertain_since
     or new.external_message_id is distinct from old.external_message_id then
    -- Clearing the fact without a transition would make a possibly sent message look safe to send.
    raise exception 'the send outcome of a message changes only with its status'
      using errcode = '42501';
  elsif actor = 'system'
     and (new.sent_at, new.delivered_at, new.read_at, new.failure_reason)
         is distinct from (old.sent_at, old.delivered_at, old.read_at, old.failure_reason)
     and lifecycle_operation is distinct from 'provider_status' then
    -- Only a WhatsApp status callback fills a delivery time without moving the status.
    raise exception 'the backend records delivery progress only through the communication lifecycle'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_message_write() from public, anon, authenticated;

-- ------------------------------------------------------------------ the lifecycle operations
-- All SECURITY INVOKER: they run as the caller, so RLS, the column grants, the audit and approval
-- triggers and the guard above all apply to them exactly as to a direct write. Each returns an outcome
-- instead of raising for the expected "someone else got there first" cases, so callers can tell them
-- apart from database failures.

-- decide: records the decision on one approval request and moves the message out of pending_approval
-- in ONE transaction (the API used to make two writes and repair a half-done decision on retry). The
-- message row is locked first, so concurrent decisions run one after the other. When the request
-- already carries this decision but the message is still pending_approval (a decision recorded
-- directly on the approval), only the status moves.
-- Outcomes: decided | not_found | not_pending | approval_decided.
create function public.decide_communication(
  p_company_id uuid,
  p_communication_id uuid,
  p_approval_id uuid,
  p_decision public.approval_decision,
  p_note text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.delivery_status;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'a decision is approved or rejected' using errcode = '22023';
  end if;

  select c.status into v_status
  from public.communications c
  where c.company_id = p_company_id and c.id = p_communication_id
  for update;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'pending_approval' then
    return 'not_pending';
  end if;

  update public.message_approvals a
     set decision = p_decision,
         decided_by_user_id = (select auth.uid()),
         decided_at = now(),
         reason = coalesce(p_note, a.reason)
   where a.company_id = p_company_id and a.communication_id = p_communication_id
     and a.id = p_approval_id and a.decision = 'pending';
  if not found and not exists (
    select 1 from public.message_approvals a
    where a.company_id = p_company_id and a.communication_id = p_communication_id
      and a.id = p_approval_id and a.decision = p_decision
  ) then
    return 'approval_decided';
  end if;

  update public.communications c
     set status = p_decision::text::public.delivery_status
   where c.company_id = p_company_id and c.id = p_communication_id;
  return 'decided';
end;
$$;
revoke all on function public.decide_communication(uuid, uuid, uuid, public.approval_decision, text) from public, anon, service_role;
grant execute on function public.decide_communication(uuid, uuid, uuid, public.approval_decision, text) to authenticated;
comment on function public.decide_communication(uuid, uuid, uuid, public.approval_decision, text) is
  'Signed-in writers. Approve or reject a message awaiting approval: decides the approval request and moves the message in one transaction. Returns decided | not_found | not_pending | approval_decided.';

-- The backend's operations below run their one write between two set_config calls naming the
-- operation (see private.guard_message_write). is_local = true: the setting ends with the transaction,
-- and a failed write rolls it back with its (sub)transaction.

-- claim: approved -> queued immediately before a send. Only one caller can win (the row lock makes a
-- concurrent claim re-check the status and find it queued). Records that the send may now happen and
-- returns that moment as the claim's token (null for every caller that did not win). The token is
-- what release and a not-sent failure on the claimed message must present.
create function public.claim_communication(p_company_id uuid, p_communication_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim timestamptz;
begin
  perform set_config('leaseguard.communication_lifecycle', 'claim', true);
  update public.communications c
     set status = 'queued', send_uncertain_since = clock_timestamp()
   where c.company_id = p_company_id and c.id = p_communication_id
     and c.status = 'approved' and c.external_message_id is null
  returning c.send_uncertain_since into v_claim;
  perform set_config('leaseguard.communication_lifecycle', '', true);
  return v_claim;
end;
$$;

-- release: queued -> approved after WhatsApp certainly refused the message, so a retry may send it.
-- Only the claim's holder knows that, so only its token releases it.
create function public.release_communication_claim(p_company_id uuid, p_communication_id uuid, p_claim timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_released boolean;
begin
  if p_claim is null then
    raise exception 'the claim being released is required' using errcode = '22023';
  end if;
  perform set_config('leaseguard.communication_lifecycle', 'release', true);
  update public.communications c
     set status = 'approved', send_uncertain_since = null
   where c.company_id = p_company_id and c.id = p_communication_id
     and c.status = 'queued' and c.external_message_id is null and c.send_uncertain_since = p_claim;
  v_released := found;  -- read before the next PERFORM, which sets FOUND itself
  perform set_config('leaseguard.communication_lifecycle', '', true);
  return v_released;
end;
$$;

-- record sent: WhatsApp accepted the message with this id. Applies to any message whose send was
-- uncertain (queued, or failed / stopped while the send was in flight): the truth wins. No token: only
-- the run that sent holds a WhatsApp id, and recording it can only make the record more true.
-- Outcomes: recorded | already_recorded | not_found | not_claimed | conflict (another id is recorded).
create function public.record_communication_sent(p_company_id uuid, p_communication_id uuid, p_provider_message_id text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_external_message_id text;
  v_send_uncertain_since timestamptz;
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'a provider message id is required' using errcode = '22023';
  end if;

  select c.external_message_id, c.send_uncertain_since into v_external_message_id, v_send_uncertain_since
  from public.communications c
  where c.company_id = p_company_id and c.id = p_communication_id
  for update;
  if not found then
    return 'not_found';
  end if;
  if v_external_message_id is not null then
    return case when v_external_message_id = p_provider_message_id then 'already_recorded' else 'conflict' end;
  end if;
  if v_send_uncertain_since is null then
    return 'not_claimed';
  end if;

  perform set_config('leaseguard.communication_lifecycle', 'record_sent', true);
  update public.communications c
     set status = 'sent', external_message_id = p_provider_message_id, sent_at = coalesce(c.sent_at, now()),
         failure_reason = null, send_uncertain_since = null
   where c.company_id = p_company_id and c.id = p_communication_id;
  perform set_config('leaseguard.communication_lifecycle', '', true);
  return 'recorded';
end;
$$;

-- record failed: the message will not be delivered. p_may_have_been_sent says whether WhatsApp may
-- have accepted it: true keeps (or records) the fact, false clears it. Only an approved or queued
-- message without a provider id can fail here; a message a person stopped meanwhile stays stopped.
--
-- Clearing the fact of a QUEUED message needs its claim token (p_claim): the claim belongs to the run
-- that made it, whose send may be in flight. A run that failed before its own claim (a stalled job's
-- second run, or a retry racing a stale run) cannot know that send's outcome, so with
-- p_may_have_been_sent = false and no matching token it changes nothing and returns false: the claim
-- holder records the outcome. With p_may_have_been_sent = true anyone may fail a queued message (a run
-- that finds a claim whose holder died); the fact is kept, so the holder's later record_sent still
-- wins. An approved message carries no claim and no fact, so no token is needed there.
create function public.record_communication_failed(
  p_company_id uuid, p_communication_id uuid, p_reason text, p_may_have_been_sent boolean, p_claim timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_failed boolean;
begin
  if p_may_have_been_sent is null then
    raise exception 'whether the message may have been sent is required' using errcode = '22023';
  end if;
  perform set_config('leaseguard.communication_lifecycle', 'record_failed', true);
  update public.communications c
     set status = 'failed',
         failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Delivery failed'), 2000),
         send_uncertain_since = case when p_may_have_been_sent then coalesce(c.send_uncertain_since, clock_timestamp()) end
   where c.company_id = p_company_id and c.id = p_communication_id
     and c.external_message_id is null
     and (c.status = 'approved'
          or (c.status = 'queued' and (p_may_have_been_sent or c.send_uncertain_since = p_claim)));
  v_failed := found;  -- read before the next PERFORM, which sets FOUND itself
  perform set_config('leaseguard.communication_lifecycle', '', true);
  return v_failed;
end;
$$;

-- record provider status: a WhatsApp status callback (sent, delivered, read, failed) for the message
-- with this provider id in this company. Callbacks may repeat and arrive in any order. The rule:
--   * each callback fills its own timestamp (sent_at, delivered_at, read_at) only when it is empty, so
--     a repeat or a late callback never rewrites a time and never loses one (a "delivered" that arrives
--     after "read" still records delivered_at);
--   * the status only moves forward along sent -> delivered -> read (a late "delivered" after "read"
--     changes no status; "read" may follow "sent" directly);
--   * "failed" applies only while the message is sent with no delivery evidence yet; after delivered
--     or read it is contradicted and ignored. A failed message stays failed;
--   * a provider id this company has not recorded yet returns not_found and changes nothing. That is
--     how a callback that overtakes the worker's record_sent ("read" before "sent" is recorded) is
--     kept: the caller retries it later (Meta does not order callbacks; the worker records the id
--     moments after WhatsApp returns it).
-- Outcomes: advanced (status moved) | recorded (a timestamp filled) | unchanged | not_found.
create function public.record_communication_provider_status(
  p_company_id uuid,
  p_provider_message_id text,
  p_status public.delivery_status,
  p_occurred_at timestamptz,
  p_failure_reason text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.delivery_status;
  v_sent_at timestamptz;
  v_delivered_at timestamptz;
  v_read_at timestamptz;
  v_next public.delivery_status;
  v_fills_time boolean;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'a provider status is sent, delivered, read or failed' using errcode = '22023';
  end if;

  select c.id, c.status, c.sent_at, c.delivered_at, c.read_at
    into v_id, v_status, v_sent_at, v_delivered_at, v_read_at
  from public.communications c
  where c.company_id = p_company_id and c.external_message_id = p_provider_message_id and c.direction = 'outbound'
  for update;
  if not found then
    return 'not_found';
  end if;

  v_next := case
    when v_status = 'failed' then v_status
    when p_status = 'failed' then case when v_status = 'sent' then 'failed'::public.delivery_status else v_status end
    when (case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end)
       > (case v_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end) then p_status
    else v_status
  end;
  v_fills_time := (p_status = 'sent' and v_sent_at is null)
    or (p_status = 'delivered' and v_delivered_at is null)
    or (p_status = 'read' and v_read_at is null);

  if v_next = v_status and not v_fills_time then
    return 'unchanged';
  end if;

  perform set_config('leaseguard.communication_lifecycle', 'provider_status', true);
  update public.communications c
     set status = v_next,
         sent_at = case when p_status = 'sent' then coalesce(c.sent_at, v_at) else c.sent_at end,
         delivered_at = case when p_status = 'delivered' then coalesce(c.delivered_at, v_at) else c.delivered_at end,
         read_at = case when p_status = 'read' then coalesce(c.read_at, v_at) else c.read_at end,
         failure_reason = case
           when v_next = 'failed' and v_status <> 'failed'
             then left(coalesce(nullif(btrim(p_failure_reason), ''), 'WhatsApp reported that the message failed'), 2000)
           else c.failure_reason
         end
   where c.id = v_id;
  perform set_config('leaseguard.communication_lifecycle', '', true);
  return case when v_next <> v_status then 'advanced' else 'recorded' end;
end;
$$;

-- The send and status operations are the backend's alone (the delivery worker and, next, the webhook).
revoke all on function public.claim_communication(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_communication_claim(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_communication_sent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_communication_failed(uuid, uuid, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.record_communication_provider_status(uuid, text, public.delivery_status, timestamptz, text) from public, anon, authenticated;
grant execute on function public.claim_communication(uuid, uuid) to service_role;
grant execute on function public.release_communication_claim(uuid, uuid, timestamptz) to service_role;
grant execute on function public.record_communication_sent(uuid, uuid, text) to service_role;
grant execute on function public.record_communication_failed(uuid, uuid, text, boolean, timestamptz) to service_role;
grant execute on function public.record_communication_provider_status(uuid, text, public.delivery_status, timestamptz, text) to service_role;

comment on function public.claim_communication(uuid, uuid) is
  'Service role only. approved -> queued before a send; returns the claim token to exactly one caller (null to the others). Records that the send may happen.';
comment on function public.release_communication_claim(uuid, uuid, timestamptz) is
  'Service role only. queued -> approved after WhatsApp certainly refused the message; only with the token of the claim being released.';
comment on function public.record_communication_sent(uuid, uuid, text) is
  'Service role only. Records the WhatsApp message id of an uncertain send. Returns recorded | already_recorded | not_found | not_claimed | conflict.';
comment on function public.record_communication_failed(uuid, uuid, text, boolean, timestamptz) is
  'Service role only. approved | queued -> failed with the reason; p_may_have_been_sent keeps the message from being sent again automatically. Recording a queued message as not sent needs its claim token (p_claim).';
comment on function public.record_communication_provider_status(uuid, text, public.delivery_status, timestamptz, text) is
  'Service role only. Applies a WhatsApp status callback, monotonic and safe out of order. Returns advanced | recorded | unchanged | not_found.';
