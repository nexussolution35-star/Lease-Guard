-- Staff take over WhatsApp conversations and reply to contacts (ticket 07).
--
-- * whatsapp_handovers: a request for a person to take over a conversation (from the company's AI agent, ticket 10,
--   or from a member of staff who takes it over). At most one unresolved handover per conversation. Members read
--   their company's handovers; only company writers (company_admin, property_manager) accept, assign and resolve
--   them, through the three functions below (no direct writes).
-- * Replies to contacts: an outbound WhatsApp message to a contact (recipient_type 'contact') now exists. It is free
--   text in a conversation, written by a company writer inside WhatsApp's 24-hour customer service window, and
--   never reaches a tenant. reply_to_whatsapp_contact creates it in one transaction through the normal lifecycle:
--   the message as an approval request, the request, and the writer's own approval (decide_communication), so the
--   approval, audit and lifecycle guards apply exactly as to any other message. The delivery worker then sends it
--   after the outbound gate (backend/src/messaging/outbound-gate.ts) has checked it again.
-- * private.guard_contact_message: the database's own line of defence for those rules, for every role. An outbound
--   contact message belongs to a conversation of that contact; the contact is not a tenant; a signed-in user creates
--   one only inside the window; and nobody claims one for sending (approved -> queued) after the window closed or
--   once the contact turned out to be a tenant.

-- ------------------------------------------------------------------ handovers
create table public.whatsapp_handovers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'resolved')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  -- 'agent': the company's AI agent asked for a person; 'member': a member of staff took the conversation over.
  requested_by text not null check (requested_by in ('agent', 'member')),
  requested_by_user_id uuid,
  -- The member who handles it: assigned by a colleague (status open until they accept) or who accepted it.
  assigned_user_id uuid,
  accepted_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_handovers_company_id_key unique (company_id, id),
  constraint whatsapp_handovers_conversation_fk foreign key (company_id, conversation_id)
    references public.whatsapp_conversations (company_id, id) on delete cascade,
  -- Members of the same company. A member who leaves keeps the handover, without the name.
  constraint whatsapp_handovers_requested_by_fk foreign key (company_id, requested_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (requested_by_user_id),
  constraint whatsapp_handovers_assigned_fk foreign key (company_id, assigned_user_id)
    references public.company_users (company_id, user_id) on delete set null (assigned_user_id),
  constraint whatsapp_handovers_resolved_by_fk foreign key (company_id, resolved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (resolved_by_user_id),
  constraint whatsapp_handovers_agent_check check (requested_by = 'member' or requested_by_user_id is null),
  constraint whatsapp_handovers_accepted_check check (status <> 'accepted' or accepted_at is not null),
  constraint whatsapp_handovers_resolved_check check ((status = 'resolved') = (resolved_at is not null))
);
comment on table public.whatsapp_handovers is
  'Requests for a person to take over a WhatsApp conversation (from the AI agent or a member). At most one unresolved per conversation. Written only through accept/assign/resolve_whatsapp_handover (writers) and the worker (service role).';
create unique index whatsapp_handovers_one_unresolved_key on public.whatsapp_handovers (company_id, conversation_id)
  where status <> 'resolved';
create index whatsapp_handovers_conversation_idx on public.whatsapp_handovers (company_id, conversation_id, created_at desc);
create index whatsapp_handovers_assigned_idx on public.whatsapp_handovers (company_id, assigned_user_id) where status <> 'resolved';
create index whatsapp_handovers_requested_by_idx on public.whatsapp_handovers (company_id, requested_by_user_id) where requested_by_user_id is not null;
create index whatsapp_handovers_resolved_by_idx on public.whatsapp_handovers (company_id, resolved_by_user_id) where resolved_by_user_id is not null;
create trigger set_updated_at before update on public.whatsapp_handovers
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_handovers
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_handovers enable row level security;
revoke all on public.whatsapp_handovers from anon, authenticated;
grant select on public.whatsapp_handovers to authenticated;
grant select, insert, update, delete on public.whatsapp_handovers to service_role;
create policy members_read on public.whatsapp_handovers for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- The caller is an active company writer of p_company_id; raises 42501 otherwise.
create function private.require_conversation_writer(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (p_company_id = any (private.company_ids_with_role('{company_admin,property_manager}'))) then
    raise exception 'only company admins and property managers handle conversations' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function private.require_conversation_writer(uuid) from public, anon;
grant execute on function private.require_conversation_writer(uuid) to authenticated;

-- accept: the caller takes the conversation over. Without an unresolved handover, one is created (requested by the
-- caller) and accepted at once. Serialised per conversation (row lock on the conversation).
-- Outcomes: accepted | already_accepted (by the caller) | accepted_by_other (assign it to take it from a colleague)
-- | not_found.
create function public.accept_whatsapp_handover(p_company_id uuid, p_conversation_id uuid)
returns table (outcome text, handover_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := private.require_conversation_writer(p_company_id);
  v_handover public.whatsapp_handovers%rowtype;
begin
  perform 1 from public.whatsapp_conversations w
  where w.company_id = p_company_id and w.id = p_conversation_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  select * into v_handover from public.whatsapp_handovers h
  where h.company_id = p_company_id and h.conversation_id = p_conversation_id and h.status <> 'resolved';
  if v_handover.id is null then
    insert into public.whatsapp_handovers (company_id, conversation_id, status, reason, requested_by, requested_by_user_id, assigned_user_id, accepted_at)
    values (p_company_id, p_conversation_id, 'accepted', 'Taken over by a member of staff', 'member', v_caller, v_caller, now())
    returning * into v_handover;
    return query select 'accepted'::text, v_handover.id;
    return;
  end if;

  if v_handover.status = 'accepted' then
    if v_handover.assigned_user_id = v_caller then
      return query select 'already_accepted'::text, v_handover.id;
    else
      return query select 'accepted_by_other'::text, v_handover.id;
    end if;
    return;
  end if;

  update public.whatsapp_handovers h
     set status = 'accepted', assigned_user_id = v_caller, accepted_at = now()
   where h.id = v_handover.id;
  return query select 'accepted'::text, v_handover.id;
end;
$$;
revoke all on function public.accept_whatsapp_handover(uuid, uuid) from public, anon, service_role;
grant execute on function public.accept_whatsapp_handover(uuid, uuid) to authenticated;
comment on function public.accept_whatsapp_handover(uuid, uuid) is
  'Company writers. Take a WhatsApp conversation over: accept its open handover, or create and accept one. Returns accepted | already_accepted | accepted_by_other | not_found.';

-- assign: hand the conversation to an active writer of the company (the caller included). Assigning to someone else
-- leaves the handover open until they accept it; assigning to oneself accepts it. Without an unresolved handover,
-- one is created (requested by the caller).
-- Outcomes: assigned | invalid_assignee | not_found.
create function public.assign_whatsapp_handover(p_company_id uuid, p_conversation_id uuid, p_assignee uuid)
returns table (outcome text, handover_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := private.require_conversation_writer(p_company_id);
  v_handover public.whatsapp_handovers%rowtype;
  v_accepts boolean := p_assignee = v_caller;
begin
  perform 1 from public.whatsapp_conversations w
  where w.company_id = p_company_id and w.id = p_conversation_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if p_assignee is null or not exists (
    select 1 from public.company_users cu join public.profiles p on p.id = cu.user_id
    where cu.company_id = p_company_id and cu.user_id = p_assignee
      and cu.role in ('company_admin', 'property_manager') and p.status = 'active'
  ) then
    return query select 'invalid_assignee'::text, null::uuid;
    return;
  end if;

  select * into v_handover from public.whatsapp_handovers h
  where h.company_id = p_company_id and h.conversation_id = p_conversation_id and h.status <> 'resolved';
  if v_handover.id is null then
    insert into public.whatsapp_handovers (company_id, conversation_id, status, reason, requested_by, requested_by_user_id, assigned_user_id, accepted_at)
    values (p_company_id, p_conversation_id, case when v_accepts then 'accepted' else 'open' end,
            'Assigned by a member of staff', 'member', v_caller, p_assignee, case when v_accepts then now() end)
    returning * into v_handover;
  else
    update public.whatsapp_handovers h
       set assigned_user_id = p_assignee,
           status = case when v_accepts then 'accepted' else 'open' end,
           accepted_at = case when v_accepts then now() end
     where h.id = v_handover.id;
  end if;
  return query select 'assigned'::text, v_handover.id;
end;
$$;
revoke all on function public.assign_whatsapp_handover(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_whatsapp_handover(uuid, uuid, uuid) to authenticated;
comment on function public.assign_whatsapp_handover(uuid, uuid, uuid) is
  'Company writers. Assign a WhatsApp conversation''s handover to an active company admin or property manager (open until they accept; accepted when it is the caller). Returns assigned | invalid_assignee | not_found.';

-- resolve: the conversation needs no person any more. Outcomes: resolved | no_handover | not_found.
create function public.resolve_whatsapp_handover(p_company_id uuid, p_conversation_id uuid, p_note text default null)
returns table (outcome text, handover_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := private.require_conversation_writer(p_company_id);
  v_handover_id uuid;
begin
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'a resolution note is at most 1 000 characters' using errcode = '22023';
  end if;
  perform 1 from public.whatsapp_conversations w
  where w.company_id = p_company_id and w.id = p_conversation_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  update public.whatsapp_handovers h
     set status = 'resolved', resolved_at = now(), resolved_by_user_id = v_caller,
         resolution_note = nullif(btrim(p_note), '')
   where h.company_id = p_company_id and h.conversation_id = p_conversation_id and h.status <> 'resolved'
  returning h.id into v_handover_id;
  if v_handover_id is null then
    return query select 'no_handover'::text, null::uuid;
    return;
  end if;
  return query select 'resolved'::text, v_handover_id;
end;
$$;
revoke all on function public.resolve_whatsapp_handover(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.resolve_whatsapp_handover(uuid, uuid, text) to authenticated;
comment on function public.resolve_whatsapp_handover(uuid, uuid, text) is
  'Company writers. Resolve a WhatsApp conversation''s unresolved handover. Returns resolved | no_handover | not_found.';

-- ------------------------------------------------------------------ outbound messages to contacts
-- A contact message may now be outbound: a reply in one of the contact's conversations.
alter table public.communications drop constraint communications_recipient_check;
alter table public.communications add constraint communications_recipient_check check (
  case recipient_type
    when 'tenant' then tenant_id is not null and owner_user_id is null
    when 'property_owner' then owner_user_id is not null and tenant_id is null
    when 'contact' then contact_id is not null and tenant_id is null and owner_user_id is null
                        and (direction = 'inbound' or conversation_id is not null)
  end
);

-- Writers name the contact and conversation of a reply (they create it through reply_to_whatsapp_contact).
-- Not updatable: a message keeps its counterparty.
grant insert (contact_id, conversation_id) on public.communications to authenticated;

-- WhatsApp's 24-hour customer service window (canReplyToContact in @leaseguard/domain).
create function private.customer_service_window_open(p_last_inbound_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_last_inbound_at is not null and p_last_inbound_at > now() - interval '24 hours'
$$;
revoke all on function private.customer_service_window_open(timestamptz) from public, anon;
grant execute on function private.customer_service_window_open(timestamptz) to authenticated, service_role;

-- The tenant a WhatsApp contact is, or null. Not only the cached link (whatsapp_contacts.tenant_id, set at the
-- contact's next inbound message): a tenant of the same company whose WhatsApp number is the contact's number, verified
-- or not, counts too, so a tenant added or renumbered after the contact last wrote is never sent a free-form reply.
-- Matches inbound routing's link (20261110100900): linking is the cautious direction.
-- SECURITY DEFINER so the answer does not depend on what the calling role may read; it returns one id only.
create function private.whatsapp_contact_tenant_id(p_company_id uuid, p_contact_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    k.tenant_id,
    (select t.id from public.tenants t
      where k.wa_id is not null and t.company_id = k.company_id and t.whatsapp_number = '+' || k.wa_id
      order by (t.status = 'vacated'), t.created_at desc, t.id
      limit 1)
  )
  from public.whatsapp_contacts k
  where k.company_id = p_company_id and k.id = p_contact_id
$$;
revoke all on function private.whatsapp_contact_tenant_id(uuid, uuid) from public, anon;
grant execute on function private.whatsapp_contact_tenant_id(uuid, uuid) to authenticated, service_role;

-- Not SECURITY DEFINER: it runs as the writing role (members read their company's conversations and contacts; the
-- service role reads all), so current_user tells a signed-in user from the backend, as in private.guard_message_write.
-- It guards creating a reply and claiming it for sending ('queued') only: every later lifecycle step (failed, released,
-- cancelled, sent, delivered, read) must still be recordable after the contact turns out to be a tenant or the window
-- closes, so the worker can fail the reply and Meta's status webhooks for a sent reply are kept.
create function private.guard_contact_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_last_inbound_at timestamptz;
  v_claim boolean;
begin
  if new.direction <> 'outbound' or new.recipient_type <> 'contact' then
    return new;
  end if;
  v_claim := tg_op = 'UPDATE' and new.status = 'queued' and old.status is distinct from 'queued';
  if tg_op <> 'INSERT' and not v_claim then
    return new;
  end if;

  select w.contact_id, w.last_inbound_at into v_contact_id, v_last_inbound_at
  from public.whatsapp_conversations w
  where w.company_id = new.company_id and w.id = new.conversation_id;
  if v_contact_id is distinct from new.contact_id then
    raise exception 'a reply to a contact belongs to one of that contact''s conversations' using errcode = '23514';
  end if;
  if private.whatsapp_contact_tenant_id(new.company_id, new.contact_id) is not null then
    raise exception 'tenants never receive free-form replies; tenant messages are approved statement and payment messages only'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and current_user = 'authenticated' and not private.customer_service_window_open(v_last_inbound_at) then
    raise exception 'the 24-hour customer service window has closed; free-form replies are only allowed within 24 hours of the contact''s last message'
      using errcode = '42501';
  end if;
  if v_claim and not private.customer_service_window_open(v_last_inbound_at) then
    raise exception 'the 24-hour customer service window has closed; this reply can no longer be sent'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_contact_message() from public, anon, authenticated;
create trigger guard_contact_message before insert or update on public.communications
  for each row execute function private.guard_contact_message();

-- One reply by a company writer to a contact, in one transaction, as the signed-in user (SECURITY INVOKER: RLS, the
-- column grants and every message guard apply). The reply goes to the conversation's contact from the conversation's
-- receiving number; the writer who writes it is its approver.
-- Outcomes: created | not_found | tenant | no_number | window_closed | number_not_connected.
create function public.reply_to_whatsapp_contact(p_company_id uuid, p_conversation_id uuid, p_body text)
returns table (outcome text, communication_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_contact_id uuid;
  v_tenant_id uuid;
  v_wa_id text;
  v_last_inbound_at timestamptz;
  v_connection text;
  v_company_number text;
  v_communication_id uuid;
  v_approval_id uuid;
  v_decided text;
begin
  if p_body is null or btrim(p_body) = '' or length(p_body) > 4096 then
    raise exception 'a reply is 1 to 4 096 characters' using errcode = '22023';
  end if;

  select w.contact_id, private.whatsapp_contact_tenant_id(w.company_id, w.contact_id), k.wa_id, w.last_inbound_at, n.connection_status,
         coalesce(nullif(n.display_number, ''), n.phone_number_id)
    into v_contact_id, v_tenant_id, v_wa_id, v_last_inbound_at, v_connection, v_company_number
  from public.whatsapp_conversations w
  join public.whatsapp_contacts k on k.company_id = w.company_id and k.id = w.contact_id
  join public.whatsapp_phone_numbers n on n.company_id = w.company_id and n.id = w.number_id
  where w.company_id = p_company_id and w.id = p_conversation_id;
  if v_contact_id is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_tenant_id is not null then
    return query select 'tenant'::text, null::uuid;
    return;
  end if;
  if v_wa_id is null then
    return query select 'no_number'::text, null::uuid;
    return;
  end if;
  if not private.customer_service_window_open(v_last_inbound_at) then
    return query select 'window_closed'::text, null::uuid;
    return;
  end if;
  if v_connection is distinct from 'connected' then
    return query select 'number_not_connected'::text, null::uuid;
    return;
  end if;

  insert into public.communications (
    company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id,
    counterparty_number, company_number, body, status, created_by_user_id
  )
  values (
    p_company_id, 'whatsapp', 'outbound', 'manual', 'contact', v_contact_id, p_conversation_id,
    '+' || v_wa_id, v_company_number, p_body, 'pending_approval', (select auth.uid())
  )
  returning id into v_communication_id;

  insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
  values (p_company_id, v_communication_id, (select auth.uid()))
  returning id into v_approval_id;

  v_decided := public.decide_communication(
    p_company_id, v_communication_id, v_approval_id, 'approved',
    'Written and approved by a member of staff as a reply to a contact'
  );
  if v_decided <> 'decided' then
    raise exception 'the reply could not be approved (%)', v_decided using errcode = '40001';
  end if;

  return query select 'created'::text, v_communication_id;
end;
$$;
revoke all on function public.reply_to_whatsapp_contact(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.reply_to_whatsapp_contact(uuid, uuid, text) to authenticated;
comment on function public.reply_to_whatsapp_contact(uuid, uuid, text) is
  'Company writers. A free-form reply to a WhatsApp contact (never a tenant) inside the 24-hour customer service window, created approved by the caller for the delivery worker. Returns created | not_found | tenant | no_number | window_closed | number_not_connected.';
