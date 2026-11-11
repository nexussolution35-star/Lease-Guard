-- The AI agent answers contacts; everything else goes to a person (ticket 10).
--
-- * whatsapp_agent_runs: one run per inbound WhatsApp message (unique per company and message), so a retried job
--   never runs the agent twice for one message. It records the outcome (replied, out_of_hours, handed_over, ignored,
--   not_configured), the model's category and confidence, the handover reason, an INTERNAL suggested reply (staff
--   only, never sent), the message the agent sent, and the model, token usage and latency. Never secrets, never the
--   prompt. Members read their company's runs; only the worker (service role) writes them, through the functions below.
-- * Agent-approved replies. A contact message the agent sends is approved by the company's own configuration (a
--   company admin turned auto-reply on and approved the knowledge it answers from), not by a person, so its message
--   approval names the agent run instead of a user (message_approvals.decided_by_agent_run_id). Only ever for a
--   contact, never a tenant: tenant messages stay approved by a person (ADR 0001), which the tenant approval guard and
--   private.guard_contact_message already enforce for every role. The move pending_approval -> approved by the
--   backend is the lifecycle operation 'agent_approve', made only inside complete_whatsapp_agent_run.
-- * start_whatsapp_agent_run / complete_whatsapp_agent_run (service role): the run's two atomic steps. Completing a
--   run creates the agent's reply (re-checking in the same transaction: not a tenant, a known number, the 24-hour
--   window, the number connected, and for the out-of-hours message that none was sent to the conversation since the
--   given time), opens a handover when a person is needed and notifies the handover contacts (or, without any, the
--   company's admins and property managers), all at most once.

-- ------------------------------------------------------------------ agent runs
create table public.whatsapp_agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  -- The inbound message the run handled.
  communication_id uuid not null,
  status text not null default 'started' check (status in ('started', 'completed')),
  outcome text check (outcome in ('replied', 'out_of_hours', 'handed_over', 'ignored', 'not_configured')),
  category text check (category in ('faq', 'business_info', 'document_request', 'complaint', 'payment_or_arrangement', 'dispute', 'lease_question', 'other')),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  handover_reason text check (handover_reason is null or length(handover_reason) between 1 and 1000),
  -- Internal, for staff only: what the agent would have answered. Never sent.
  suggested_reply text check (suggested_reply is null or length(suggested_reply) <= 4000),
  -- The message the agent sent (its answer or the out-of-hours message).
  reply_communication_id uuid,
  handover_id uuid,
  model text check (model is null or length(model) <= 100),
  stop_reason text check (stop_reason is null or length(stop_reason) <= 60),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cache_read_input_tokens integer check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens integer check (cache_creation_input_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  -- A safe description of a model or runtime failure (never the request, a key or message text).
  error_message text check (error_message is null or length(error_message) <= 1000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_agent_runs_company_id_key unique (company_id, id),
  constraint whatsapp_agent_runs_communication_key unique (company_id, communication_id),
  constraint whatsapp_agent_runs_conversation_fk foreign key (company_id, conversation_id)
    references public.whatsapp_conversations (company_id, id) on delete cascade,
  constraint whatsapp_agent_runs_communication_fk foreign key (company_id, communication_id)
    references public.communications (company_id, id) on delete cascade,
  constraint whatsapp_agent_runs_reply_fk foreign key (company_id, reply_communication_id)
    references public.communications (company_id, id) on delete set null (reply_communication_id),
  constraint whatsapp_agent_runs_handover_fk foreign key (company_id, handover_id)
    references public.whatsapp_handovers (company_id, id) on delete set null (handover_id),
  constraint whatsapp_agent_runs_completed_check check ((status = 'completed') = (completed_at is not null and outcome is not null)),
  constraint whatsapp_agent_runs_reply_check check (reply_communication_id is null or outcome in ('replied', 'out_of_hours'))
);
comment on table public.whatsapp_agent_runs is
  'One AI agent run per inbound WhatsApp message: outcome, category, confidence, handover reason, internal suggested reply (never sent), the reply sent, model and usage. Written only by the worker (service role).';
create index whatsapp_agent_runs_conversation_idx on public.whatsapp_agent_runs (company_id, conversation_id, created_at desc);
-- The out-of-hours check: the conversation's latest out-of-hours run.
create index whatsapp_agent_runs_out_of_hours_idx on public.whatsapp_agent_runs (company_id, conversation_id, completed_at desc)
  where outcome = 'out_of_hours';
create index whatsapp_agent_runs_reply_idx on public.whatsapp_agent_runs (company_id, reply_communication_id) where reply_communication_id is not null;
create index whatsapp_agent_runs_handover_idx on public.whatsapp_agent_runs (company_id, handover_id) where handover_id is not null;
create trigger set_updated_at before update on public.whatsapp_agent_runs
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_agent_runs
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_agent_runs enable row level security;
revoke all on public.whatsapp_agent_runs from anon, authenticated;
grant select on public.whatsapp_agent_runs to authenticated;
grant select, insert, update, delete on public.whatsapp_agent_runs to service_role;
create policy members_read on public.whatsapp_agent_runs for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- ------------------------------------------------------------------ approvals by the agent
alter table public.message_approvals
  add column decided_by_agent_run_id uuid,
  alter column requested_by_user_id drop not null,
  add constraint message_approvals_agent_run_fk foreign key (company_id, decided_by_agent_run_id)
    references public.whatsapp_agent_runs (company_id, id) on delete cascade,
  -- The agent only ever approves its own reply, at once: approved, by no person.
  add constraint message_approvals_agent_check check (
    decided_by_agent_run_id is null or (decision = 'approved' and decided_by_user_id is null and decided_at is not null)
  ),
  -- A person requests every other approval.
  add constraint message_approvals_requester_check check (requested_by_user_id is not null or decided_by_agent_run_id is not null);
comment on column public.message_approvals.decided_by_agent_run_id is
  'Set when the company''s AI agent approved its own reply to a contact (never a tenant) under the company''s auto-reply setting. Written only by complete_whatsapp_agent_run.';
create index message_approvals_agent_run_idx on public.message_approvals (company_id, decided_by_agent_run_id)
  where decided_by_agent_run_id is not null;

-- Signed-in writers keep every column but the agent's (they had table-wide insert and update).
revoke insert, update on public.message_approvals from authenticated;
grant insert (id, company_id, communication_id, requested_by_user_id, requested_at, decision, decided_by_user_id, decided_at, reason)
  on public.message_approvals to authenticated;
grant update (communication_id, requested_by_user_id, requested_at, decision, decided_by_user_id, decided_at, reason)
  on public.message_approvals to authenticated;

-- The backend may approve a message only as the agent's own reply. The transition table was keyed by the status
-- pair alone; the actor joins the key so the same move can be a person's decision and the agent's approval.
alter table private.communication_status_transitions drop constraint communication_status_transitions_pkey;
alter table private.communication_status_transitions add primary key (from_status, to_status, actor);
insert into private.communication_status_transitions (from_status, to_status, operation, actor) values
  ('pending_approval', 'approved', 'agent_approve', 'system');

-- ------------------------------------------------------------------ start
-- One run per inbound message: creates it, or returns the existing one (a retried job). Outcomes: started (new),
-- running (an earlier attempt started it and did not finish: nothing was sent, run it again), completed (done:
-- never run again; its reply, if any, is returned so the caller can make sure it is delivered), not_found (no such
-- inbound WhatsApp message in a conversation of the company).
create function public.start_whatsapp_agent_run(p_company_id uuid, p_communication_id uuid)
returns table (outcome text, run_id uuid, conversation_id uuid, reply_communication_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_conversation_id uuid;
  v_run public.whatsapp_agent_runs%rowtype;
begin
  select c.conversation_id into v_conversation_id
  from public.communications c
  where c.company_id = p_company_id and c.id = p_communication_id
    and c.direction = 'inbound' and c.channel = 'whatsapp' and c.conversation_id is not null;
  if v_conversation_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  insert into public.whatsapp_agent_runs (company_id, conversation_id, communication_id)
  values (p_company_id, v_conversation_id, p_communication_id)
  on conflict (company_id, communication_id) do nothing
  returning * into v_run;
  if v_run.id is not null then
    return query select 'started'::text, v_run.id, v_conversation_id, null::uuid;
    return;
  end if;

  select * into v_run from public.whatsapp_agent_runs r
  where r.company_id = p_company_id and r.communication_id = p_communication_id;
  return query select case when v_run.status = 'completed' then 'completed' else 'running' end,
    v_run.id, v_conversation_id, v_run.reply_communication_id;
end;
$$;
revoke all on function public.start_whatsapp_agent_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_whatsapp_agent_run(uuid, uuid) to service_role;
comment on function public.start_whatsapp_agent_run(uuid, uuid) is
  'Service role only. Starts the AI agent run for one inbound WhatsApp message, at most once per message. Returns started | running | completed | not_found.';

-- ------------------------------------------------------------------ complete
-- Records what the agent policy decided (rules/agentPolicy.ts in @leaseguard/domain) and carries it out, once:
-- * p_reply_text with p_outcome replied | out_of_hours: the reply to the contact, created agent-approved for the
--   delivery worker (which checks it again through the outbound gate before it claims and sends it). Re-checked here
--   first; when the contact is a tenant, has no number, the window closed, the number is not connected or (out of
--   hours) an out-of-hours message already went to the conversation at or after p_out_of_hours_since, nothing is sent
--   and the outcome becomes handed_over.
-- * p_handover_reason: a handover requested by the agent, unless the conversation already has an unresolved one, and a
--   notification to each handover contact who is still an active company admin or property manager (else every active
--   company admin and property manager, so a handover is never silent).
-- Serialised per conversation (row lock). A completed run is returned as it is (outcome already_completed).
-- Outcomes: completed | already_completed | not_found.
create function public.complete_whatsapp_agent_run(
  p_company_id uuid,
  p_run_id uuid,
  p_outcome text,
  p_category text,
  p_confidence numeric,
  p_handover_reason text,
  p_suggested_reply text,
  p_reply_text text,
  p_out_of_hours_since timestamptz,
  p_model text,
  p_stop_reason text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_input_tokens integer,
  p_cache_creation_input_tokens integer,
  p_latency_ms integer,
  p_error_message text
)
returns table (outcome text, run_outcome text, reply_communication_id uuid, handover_id uuid, notified integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_run public.whatsapp_agent_runs%rowtype;
  v_outcome text := p_outcome;
  v_reason text := nullif(btrim(p_handover_reason), '');
  v_contact_id uuid;
  v_is_tenant boolean;
  v_wa_id text;
  v_last_inbound_at timestamptz;
  v_connection text;
  v_company_number text;
  v_blocked text;
  v_reply_id uuid;
  v_handover_id uuid;
  v_new_handover boolean := false;
  v_notified integer := 0;
begin
  if p_outcome is null or p_outcome not in ('replied', 'out_of_hours', 'handed_over', 'ignored', 'not_configured') then
    raise exception 'an agent run outcome is replied, out_of_hours, handed_over, ignored or not_configured' using errcode = '22023';
  end if;
  if (p_outcome in ('replied', 'out_of_hours')) <> (nullif(btrim(p_reply_text), '') is not null) then
    raise exception 'a reply text comes with, and only with, a replied or out_of_hours outcome' using errcode = '22023';
  end if;
  if p_outcome = 'out_of_hours' and p_out_of_hours_since is null then
    raise exception 'an out-of-hours reply names since when it is sent at most once' using errcode = '22023';
  end if;
  if p_outcome in ('out_of_hours', 'handed_over') and v_reason is null then
    raise exception 'a handover needs a reason' using errcode = '22023';
  end if;
  if length(p_reply_text) > 4096 then
    raise exception 'a reply is at most 4 096 characters' using errcode = '22023';
  end if;

  select * into v_run from public.whatsapp_agent_runs r
  where r.company_id = p_company_id and r.id = p_run_id;
  if v_run.id is null then
    return query select 'not_found'::text, null::text, null::uuid, null::uuid, 0;
    return;
  end if;

  -- The conversation first, then the run: every writer of this conversation's runs and handovers takes the same order.
  select w.contact_id, w.last_inbound_at, private.whatsapp_contact_tenant_id(w.company_id, w.contact_id) is not null,
         k.wa_id, n.connection_status::text, coalesce(nullif(n.display_number, ''), n.phone_number_id)
    into v_contact_id, v_last_inbound_at, v_is_tenant, v_wa_id, v_connection, v_company_number
  from public.whatsapp_conversations w
  join public.whatsapp_contacts k on k.company_id = w.company_id and k.id = w.contact_id
  join public.whatsapp_phone_numbers n on n.company_id = w.company_id and n.id = w.number_id
  where w.company_id = p_company_id and w.id = v_run.conversation_id
  for update of w;

  select * into v_run from public.whatsapp_agent_runs r
  where r.company_id = p_company_id and r.id = p_run_id
  for update;
  if v_run.status = 'completed' then
    return query select 'already_completed'::text, v_run.outcome, v_run.reply_communication_id, v_run.handover_id, 0;
    return;
  end if;

  if v_outcome in ('replied', 'out_of_hours') then
    v_blocked := case
      when v_is_tenant is not false then 'The contact is a tenant: tenants are never answered automatically'
      when v_wa_id is null then 'WhatsApp has not shared the contact''s number'
      when not private.customer_service_window_open(v_last_inbound_at) then 'WhatsApp''s 24-hour customer service window has closed'
      when v_connection is distinct from 'connected' then 'The conversation''s WhatsApp number is not connected'
      -- Re-read under the conversation lock: the model call takes seconds, and a person may take the conversation
      -- over (accept_whatsapp_handover / assign_whatsapp_handover take the same lock) or an admin may turn
      -- auto-reply off in the meantime. Either one stops the agent sending.
      when not coalesce((select c.auto_reply_enabled from public.whatsapp_agent_configs c where c.company_id = p_company_id), false)
        then 'Auto-reply is off: a person answers contacts'
      when exists (
        select 1 from public.whatsapp_handovers h
        where h.company_id = p_company_id and h.conversation_id = v_run.conversation_id and h.status <> 'resolved'
      ) then 'A person is handling this conversation'
    end;
    if v_blocked is null and v_outcome = 'out_of_hours' and exists (
      select 1 from public.whatsapp_agent_runs r
      where r.company_id = p_company_id and r.conversation_id = v_run.conversation_id
        and r.outcome = 'out_of_hours' and r.completed_at >= p_out_of_hours_since
    ) then
      -- Already told this window: hand over without sending it again.
      v_outcome := 'handed_over';
    elsif v_blocked is not null then
      v_outcome := 'handed_over';
      v_reason := coalesce(v_reason || '. ', '') || v_blocked;
    else
      insert into public.communications (
        company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id,
        counterparty_number, company_number, body, status
      )
      values (
        p_company_id, 'whatsapp', 'outbound', 'manual', 'contact', v_contact_id, v_run.conversation_id,
        '+' || v_wa_id, v_company_number, p_reply_text, 'pending_approval'
      )
      returning id into v_reply_id;

      insert into public.message_approvals (company_id, communication_id, decision, decided_at, decided_by_agent_run_id, reason)
      values (p_company_id, v_reply_id, 'approved', now(), p_run_id,
              case v_outcome when 'out_of_hours' then 'The company''s out-of-hours message, sent by its AI agent'
                             else 'Answered by the company''s AI agent from its approved knowledge (auto-reply on)' end);

      perform set_config('leaseguard.communication_lifecycle', 'agent_approve', true);
      update public.communications c set status = 'approved'
      where c.company_id = p_company_id and c.id = v_reply_id;
      perform set_config('leaseguard.communication_lifecycle', '', true);
    end if;
  end if;

  if v_outcome in ('out_of_hours', 'handed_over') then
    select h.id into v_handover_id from public.whatsapp_handovers h
    where h.company_id = p_company_id and h.conversation_id = v_run.conversation_id and h.status <> 'resolved';
    if v_handover_id is null then
      insert into public.whatsapp_handovers (company_id, conversation_id, status, reason, requested_by)
      values (p_company_id, v_run.conversation_id, 'open', left(v_reason, 1000), 'agent')
      returning id into v_handover_id;
      v_new_handover := true;
    end if;
  end if;

  if v_new_handover then
    with contacts as (
      select hc.user_id from public.whatsapp_agent_handover_contacts hc
      join public.company_users cu on cu.company_id = hc.company_id and cu.user_id = hc.user_id
      join public.profiles p on p.id = hc.user_id
      where hc.company_id = p_company_id and cu.role in ('company_admin', 'property_manager') and p.status = 'active'
    ),
    recipients as (
      select user_id from contacts
      union
      select cu.user_id from public.company_users cu
      join public.profiles p on p.id = cu.user_id
      where cu.company_id = p_company_id and cu.role in ('company_admin', 'property_manager') and p.status = 'active'
        and not exists (select 1 from contacts)
    ),
    inserted as (
      insert into public.notifications (company_id, user_id, type, severity, title, body, link_entity_type, link_entity_id, dedupe_key)
      select p_company_id, r.user_id, 'system', 'warning', 'WhatsApp conversation needs a person',
             left('The AI agent handed a WhatsApp conversation to a person: ' || v_reason
                  || '. Open WhatsApp conversations to accept it.', 2000),
             'communication', v_run.communication_id,
             'whatsapp-handover:' || v_handover_id::text || ':' || r.user_id::text
      from recipients r
      on conflict (company_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::integer into v_notified from inserted;
  end if;

  update public.whatsapp_agent_runs r
     set status = 'completed',
         outcome = v_outcome,
         category = p_category,
         confidence = p_confidence,
         handover_reason = case when v_outcome in ('out_of_hours', 'handed_over') then left(v_reason, 1000) end,
         suggested_reply = left(nullif(btrim(p_suggested_reply), ''), 4000),
         reply_communication_id = v_reply_id,
         handover_id = v_handover_id,
         model = left(p_model, 100),
         stop_reason = left(p_stop_reason, 60),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cache_read_input_tokens = p_cache_read_input_tokens,
         cache_creation_input_tokens = p_cache_creation_input_tokens,
         latency_ms = p_latency_ms,
         error_message = left(nullif(btrim(p_error_message), ''), 1000),
         completed_at = now()
   where r.id = p_run_id;

  return query select 'completed'::text, v_outcome, v_reply_id, v_handover_id, v_notified;
end;
$$;
revoke all on function public.complete_whatsapp_agent_run(uuid, uuid, text, text, numeric, text, text, text, timestamptz, text, text, integer, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp_agent_run(uuid, uuid, text, text, numeric, text, text, text, timestamptz, text, text, integer, integer, integer, integer, integer, text)
  to service_role;
comment on function public.complete_whatsapp_agent_run(uuid, uuid, text, text, numeric, text, text, text, timestamptz, text, text, integer, integer, integer, integer, integer, text) is
  'Service role only. Completes an AI agent run once: the agent-approved reply to a contact (re-checked: never a tenant, inside the window, out-of-hours at most once), a handover with notifications, and the run''s outcome and usage. Returns completed | already_completed | not_found.';
