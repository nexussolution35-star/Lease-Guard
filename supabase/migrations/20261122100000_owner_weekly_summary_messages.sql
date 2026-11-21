-- Weekly owner summaries in the core messaging pipeline (ticket R-07, ADR 0003).
--
-- The reports service computes each property owner's weekly summary, stores it in its own reports_owner_summaries and
-- asks the core messaging pipeline to send it on the `owner-summary-delivery` queue. The core worker (service role)
-- records the message here and delivers it like every other message: the outbound gate, the communication lifecycle,
-- the message-delivery queue and WhatsApp's status callbacks. Only the core worker calls Meta.
--
--   * communications.owner_summary_week: the Monday of the week an owner_weekly_summary is for. One message per
--     company, owner and week (communications_owner_summary_week_key), so a repeated job never messages an owner
--     twice. Signed-in users cannot set it (their column grants on communications do not name it).
--   * Approved by the schedule. A person approves every tenant message (ADR 0001) and every other message the
--     company sends, except two sent on the company's own configuration: the AI agent's replies to contacts
--     (decided_by_agent_run_id) and, now, the weekly owner summary, sent on the company's owner summary day (Settings
--     → Monitoring) through the template a company admin chose for it (Settings → Message templates). Its approval
--     records `approved_by_schedule` instead of a person, only ever for an owner_weekly_summary to a property owner
--     (guard below), and the lifecycle move pending_approval -> approved is the backend operation 'schedule_approve',
--     made only inside public.record_owner_weekly_summary_message.
--   * public.record_owner_weekly_summary_message (service role only): creates the week's message for one owner, or
--     returns the one already recorded. It refuses (returns `blocked` with the reason, creating nothing) unless the
--     owner is an active property owner of the company with a WhatsApp number, an approved template is chosen for
--     owner_weekly_summary and the company has a connected number. The company's default number (its earliest-added
--     connected number, the channel module's rule) is the message's company number.

-- ------------------------------------------------------------------ one message per owner and week
alter table public.communications
  add column owner_summary_week date,
  add constraint communications_owner_summary_week_check check (
    owner_summary_week is null
    or (message_type = 'owner_weekly_summary' and recipient_type = 'property_owner' and direction = 'outbound'
        and extract(isodow from owner_summary_week) = 1)
  );
comment on column public.communications.owner_summary_week is
  'For an owner_weekly_summary: the Monday of the week it summarises (one per company, owner and week). Written only by record_owner_weekly_summary_message.';
create unique index communications_owner_summary_week_key on public.communications (company_id, owner_user_id, owner_summary_week)
  where owner_summary_week is not null;

-- ------------------------------------------------------------------ approved by the schedule
alter table public.message_approvals
  add column approved_by_schedule boolean not null default false,
  -- Approved at once, by no person and no agent run, and only an owner_weekly_summary (checked by the guard below).
  add constraint message_approvals_schedule_check check (
    not approved_by_schedule
    or (decision = 'approved' and decided_by_user_id is null and decided_by_agent_run_id is null and decided_at is not null)
  ),
  drop constraint message_approvals_requester_check,
  add constraint message_approvals_requester_check check (
    requested_by_user_id is not null or decided_by_agent_run_id is not null or approved_by_schedule
  );
comment on column public.message_approvals.approved_by_schedule is
  'True when the message is a weekly owner summary approved by the company''s owner summary schedule (Settings → Monitoring) and its chosen template, not by a person. Never a tenant message. Written only by record_owner_weekly_summary_message.';

create function private.guard_schedule_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approved_by_schedule and not exists (
    select 1 from public.communications c
    where c.company_id = new.company_id and c.id = new.communication_id
      and c.message_type = 'owner_weekly_summary' and c.recipient_type = 'property_owner' and c.direction = 'outbound'
  ) then
    raise exception 'only a weekly owner summary to a property owner is approved by the schedule'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.approved_by_schedule is distinct from old.approved_by_schedule then
    raise exception 'how a message was approved cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_schedule_approval before insert or update on public.message_approvals
  for each row execute function private.guard_schedule_approval();

-- The backend's two approvals (the agent's and the schedule's) are the same status move by the same actor; the
-- operation joins the key, and the lifecycle setting the function names picks its own.
alter table private.communication_status_transitions drop constraint communication_status_transitions_pkey;
alter table private.communication_status_transitions add primary key (from_status, to_status, actor, operation);
insert into private.communication_status_transitions (from_status, to_status, operation, actor) values
  ('pending_approval', 'approved', 'schedule_approve', 'system');

create or replace function private.communication_transition(p_from public.delivery_status, p_to public.delivery_status, p_actor text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- One operation per move, except the backend's approvals: the operation the caller names in
  -- leaseguard.communication_lifecycle when there is one, else the first (which the guard then refuses).
  select t.operation from private.communication_status_transitions t
  where t.from_status = p_from and t.to_status = p_to and t.actor = p_actor
  order by (t.operation = nullif(current_setting('leaseguard.communication_lifecycle', true), '')) desc nulls last, t.operation
  limit 1
$$;

-- ------------------------------------------------------------------ record one owner's summary message
create function public.record_owner_weekly_summary_message(
  p_company_id uuid,
  p_owner_user_id uuid,
  p_week_start date,
  p_body text
)
returns table (outcome text, communication_id uuid, reason text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_existing uuid;
  v_owner_number text;
  v_template_id uuid;
  v_company_number text;
  v_id uuid;
begin
  if p_company_id is null or p_owner_user_id is null or p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'a weekly owner summary names its company, owner and the Monday of its week' using errcode = '22023';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'a weekly owner summary has text' using errcode = '22023';
  end if;

  -- Serialise the owner's week, so two runs cannot both create it.
  perform pg_advisory_xact_lock(hashtextextended('owner-summary:' || p_company_id::text || ':' || p_owner_user_id::text || ':' || p_week_start::text, 0));

  select c.id into v_existing from public.communications c
  where c.company_id = p_company_id and c.owner_user_id = p_owner_user_id and c.owner_summary_week = p_week_start;
  if v_existing is not null then
    return query select 'existing'::text, v_existing, null::text;
    return;
  end if;

  if not exists (
    select 1 from public.company_users cu
    where cu.company_id = p_company_id and cu.user_id = p_owner_user_id and cu.role = 'property_owner'
  ) then
    return query select 'blocked'::text, null::uuid, 'User is not a property owner in this company'::text;
    return;
  end if;
  select p.whatsapp_number into v_owner_number from public.profiles p where p.id = p_owner_user_id and p.status = 'active';
  if v_owner_number is null then
    return query select 'blocked'::text, null::uuid, 'The owner is not active or has no WhatsApp number on record'::text;
    return;
  end if;

  select t.id into v_template_id
  from public.message_type_templates m
  join public.message_templates t on t.company_id = m.company_id and t.id = m.message_template_id
  where m.company_id = p_company_id and m.message_type = 'owner_weekly_summary' and t.approval_status = 'approved';
  if v_template_id is null then
    return query select 'blocked'::text, null::uuid, 'No WhatsApp template approved by Meta is chosen for the weekly owner summary'::text;
    return;
  end if;

  select coalesce(nullif(n.display_number, ''), n.phone_number_id) into v_company_number
  from public.whatsapp_phone_numbers n
  where n.company_id = p_company_id and n.connection_status = 'connected'
  order by n.created_at, n.id
  limit 1;
  if v_company_number is null then
    return query select 'blocked'::text, null::uuid, 'The company has no connected WhatsApp number'::text;
    return;
  end if;

  insert into public.communications (
    company_id, channel, direction, message_type, recipient_type, owner_user_id, template_id,
    counterparty_number, company_number, body, status, owner_summary_week
  )
  values (
    p_company_id, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', p_owner_user_id, v_template_id,
    v_owner_number, v_company_number, p_body, 'pending_approval', p_week_start
  )
  returning id into v_id;

  insert into public.message_approvals (company_id, communication_id, decision, decided_at, approved_by_schedule, reason)
  values (p_company_id, v_id, 'approved', now(), true,
          'Weekly owner summary, sent on the company''s owner summary day with the template chosen for it');

  perform set_config('leaseguard.communication_lifecycle', 'schedule_approve', true);
  update public.communications c set status = 'approved' where c.company_id = p_company_id and c.id = v_id;
  perform set_config('leaseguard.communication_lifecycle', '', true);

  return query select 'created'::text, v_id, null::text;
end;
$$;
revoke all on function public.record_owner_weekly_summary_message(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.record_owner_weekly_summary_message(uuid, uuid, date, text) to service_role;
comment on function public.record_owner_weekly_summary_message(uuid, uuid, date, text) is
  'Core worker (R-07): records one owner''s weekly summary as an approved owner_weekly_summary communication (once per owner and week), or says why not. Service role only.';
