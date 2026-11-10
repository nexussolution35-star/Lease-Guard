-- Inbound WhatsApp messages land in the right company's inbox (ticket 05).
--
-- Meta calls one LeaseGuard webhook for every company. The API checks Meta's signature and queues the
-- raw payload; the worker (service role) records it here and routes each message by its receiving
-- number only (ADR 0002):
--
-- * whatsapp_webhook_events: every signed payload, once (unique SHA-256 of the raw body), with what
--   processing did with each change (recorded, duplicate, unknown receiving number, not handled yet).
--   It is written before routing, so it has no company: service role only, members never read raw
--   payloads (they see the routed messages).
-- * whatsapp_contacts: a company's WhatsApp counterparties, identified by Meta's business-scoped user id
--   (BSUID, `user_id`) and/or the WhatsApp number (`wa_id`); Meta may omit the number. A contact may be
--   linked to a tenant of the SAME company whose WhatsApp number is the contact's number.
-- * whatsapp_conversations: one thread per receiving number and contact, with the time of the last
--   inbound message (it opens WhatsApp's 24-hour customer service window).
-- * communications: inbound messages are recorded as before (direction inbound, status received) and now
--   carry their contact and conversation. The sender's number may be unknown (BSUID only), and a sender
--   who is not a tenant is recipient_type 'contact'. Meta's message id is unique per company (was global),
--   so a retried delivery is recorded once per company.
-- * record_whatsapp_inbound_message (service role): one atomic step per message: check the receiving
--   number is the company's connected number, deduplicate, find or create the contact, link the tenant,
--   thread the conversation, insert the message.

-- ------------------------------------------------------------------ webhook events (no company: pre-routing)
create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  -- When the API accepted the signed request.
  received_at timestamptz not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'failed')),
  processed_at timestamptz,
  -- One entry per change/message: { field, phoneNumberId, outcome, ... }. Never message text.
  outcomes jsonb not null default '[]'::jsonb check (jsonb_typeof(outcomes) = 'array'),
  error_message text check (error_message is null or length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_webhook_events_payload_sha256_key unique (payload_sha256),
  constraint whatsapp_webhook_events_processed_check check ((processing_status = 'received') = (processed_at is null))
);
comment on table public.whatsapp_webhook_events is
  'Every signed Meta webhook payload, once (by SHA-256 of the raw body), and what routing did with each change. Recorded before the company is known, so service role only.';
create index whatsapp_webhook_events_received_idx on public.whatsapp_webhook_events (received_at desc);
create trigger set_updated_at before update on public.whatsapp_webhook_events
  for each row execute function private.set_updated_at();

alter table public.whatsapp_webhook_events enable row level security;
revoke all on public.whatsapp_webhook_events from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_webhook_events to service_role;

-- ------------------------------------------------------------------ contacts
create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Meta's business-scoped user id (BSUID), e.g. 'US.1349…'. Meta may send it, the number, or both.
  user_id text check (user_id is null or length(user_id) between 1 and 128),
  -- The sender's WhatsApp number as Meta sends it: digits with country code, no '+'.
  wa_id text check (wa_id is null or wa_id ~ '^[1-9][0-9]{6,14}$'),
  profile_name text check (profile_name is null or length(profile_name) <= 200),
  -- A tenant of the same company whose WhatsApp number is this contact's number.
  tenant_id uuid,
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_contacts_company_id_key unique (company_id, id),
  constraint whatsapp_contacts_identity_check check (user_id is not null or wa_id is not null),
  constraint whatsapp_contacts_tenant_fk foreign key (company_id, tenant_id) references public.tenants (company_id, id)
);
comment on table public.whatsapp_contacts is
  'A company''s WhatsApp counterparties, by Meta business-scoped user id and/or number; optionally linked to a tenant of the same company. Written by the worker (service role).';
create unique index whatsapp_contacts_company_user_id_key on public.whatsapp_contacts (company_id, user_id) where user_id is not null;
create unique index whatsapp_contacts_company_wa_id_key on public.whatsapp_contacts (company_id, wa_id) where wa_id is not null;
create index whatsapp_contacts_tenant_idx on public.whatsapp_contacts (company_id, tenant_id) where tenant_id is not null;
create trigger set_updated_at before update on public.whatsapp_contacts
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_contacts
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_contacts enable row level security;
revoke all on public.whatsapp_contacts from anon, authenticated;
grant select on public.whatsapp_contacts to authenticated;
grant select, insert, update, delete on public.whatsapp_contacts to service_role;
create policy members_read on public.whatsapp_contacts for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- ------------------------------------------------------------------ conversations
create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The company's receiving number the contact wrote to.
  number_id uuid not null,
  contact_id uuid not null,
  -- The last message the contact sent (WhatsApp's 24-hour customer service window runs from it).
  last_inbound_at timestamptz,
  last_message_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_company_id_key unique (company_id, id),
  constraint whatsapp_conversations_thread_key unique (company_id, number_id, contact_id),
  constraint whatsapp_conversations_number_fk foreign key (company_id, number_id) references public.whatsapp_phone_numbers (company_id, id),
  constraint whatsapp_conversations_contact_fk foreign key (company_id, contact_id) references public.whatsapp_contacts (company_id, id) on delete cascade
);
comment on table public.whatsapp_conversations is
  'One WhatsApp thread per receiving number and contact of a company. Written by the worker (service role).';
create index whatsapp_conversations_company_last_message_idx on public.whatsapp_conversations (company_id, last_message_at desc, id desc);
create index whatsapp_conversations_contact_idx on public.whatsapp_conversations (company_id, contact_id);
create trigger set_updated_at before update on public.whatsapp_conversations
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_conversations
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from anon, authenticated;
grant select on public.whatsapp_conversations to authenticated;
grant select, insert, update, delete on public.whatsapp_conversations to service_role;
create policy members_read on public.whatsapp_conversations for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- ------------------------------------------------------------------ communications thread into conversations
alter table public.communications
  add column contact_id uuid,
  add column conversation_id uuid,
  -- When the sender sent an inbound message (Meta's timestamp). Outbound messages use sent_at.
  add column received_at timestamptz,
  add constraint communications_contact_fk foreign key (company_id, contact_id) references public.whatsapp_contacts (company_id, id),
  add constraint communications_conversation_fk foreign key (company_id, conversation_id) references public.whatsapp_conversations (company_id, id),
  add constraint communications_received_at_check check (direction = 'inbound' or received_at is null);
create index communications_conversation_idx on public.communications (company_id, conversation_id, created_at) where conversation_id is not null;
create index communications_contact_idx on public.communications (company_id, contact_id) where contact_id is not null;

-- Meta may identify a sender by business-scoped user id only: an inbound message may have no number.
alter table public.communications alter column counterparty_number drop not null;
alter table public.communications
  add constraint communications_counterparty_number_check check (direction = 'inbound' or counterparty_number is not null);

-- A 'contact' counterparty is a WhatsApp contact that is not a tenant or owner. Until replies to contacts
-- exist (ticket 07) a contact message is inbound only.
alter table public.communications drop constraint communications_recipient_check;
alter table public.communications add constraint communications_recipient_check check (
  case recipient_type
    when 'tenant' then tenant_id is not null and owner_user_id is null
    when 'property_owner' then owner_user_id is not null and tenant_id is null
    when 'contact' then contact_id is not null and tenant_id is null and owner_user_id is null and direction = 'inbound'
  end
);

-- Meta's message id identifies a message within the company that received or sent it.
alter table public.communications drop constraint communications_external_message_id_key;
alter table public.communications
  add constraint communications_company_external_message_id_key unique (company_id, external_message_id);

-- ------------------------------------------------------------------ the routing step
-- One inbound message for one company. The worker has already chosen the company from the receiving
-- number (WhatsAppChannels.forReceivingNumber); this re-checks, in the same transaction as the writes,
-- that the number is still that company's CONNECTED number, so a number disconnected meanwhile drops the
-- message. The sender only identifies the contact WITHIN that company.
--
-- Serialised per company (transaction advisory lock): two deliveries of one message, or two first
-- messages of one new sender, cannot both insert.
--
-- Outcomes: recorded | duplicate (this company already holds the Meta message id) | unknown_number.
create function public.record_whatsapp_inbound_message(
  p_company_id uuid,
  p_number_id uuid,
  p_provider_message_id text,
  p_user_id text,
  p_wa_id text,
  p_profile_name text,
  p_body text,
  p_sent_at timestamptz
)
returns table (outcome text, communication_id uuid, conversation_id uuid, contact_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_company_number text;
  v_at timestamptz := least(coalesce(p_sent_at, now()), now());
  v_user_id text := nullif(btrim(p_user_id), '');
  v_wa_id text := nullif(btrim(p_wa_id), '');
  v_profile_name text := left(nullif(btrim(p_profile_name), ''), 200);
  v_contact public.whatsapp_contacts%rowtype;
  v_tenant_id uuid;
  v_conversation_id uuid;
  v_communication_id uuid;
  v_existing_contact_id uuid;
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' or length(p_provider_message_id) > 256 then
    raise exception 'a WhatsApp message id is required' using errcode = '22023';
  end if;
  if v_user_id is null and v_wa_id is null then
    raise exception 'the sender is identified by a business-scoped user id or a WhatsApp number' using errcode = '22023';
  end if;

  select coalesce(nullif(n.display_number, ''), n.phone_number_id) into v_company_number
  from public.whatsapp_phone_numbers n
  where n.company_id = p_company_id and n.id = p_number_id and n.connection_status = 'connected';
  if not found then
    return query select 'unknown_number'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('whatsapp_inbound:' || p_company_id::text, 0));

  select c.id, c.conversation_id, c.contact_id into v_communication_id, v_conversation_id, v_existing_contact_id
  from public.communications c
  where c.company_id = p_company_id and c.external_message_id = p_provider_message_id;
  if found then
    return query select 'duplicate'::text, v_communication_id, v_conversation_id, v_existing_contact_id;
    return;
  end if;

  -- The contact: by business-scoped user id first, then by number.
  if v_user_id is not null then
    select * into v_contact from public.whatsapp_contacts k where k.company_id = p_company_id and k.user_id = v_user_id;
  end if;
  if v_contact.id is null and v_wa_id is not null then
    select * into v_contact from public.whatsapp_contacts k where k.company_id = p_company_id and k.wa_id = v_wa_id;
  end if;

  if v_contact.id is null then
    insert into public.whatsapp_contacts (company_id, user_id, wa_id, profile_name, first_message_at, last_message_at)
    values (p_company_id, v_user_id, v_wa_id, v_profile_name, v_at, v_at)
    returning * into v_contact;
  else
    update public.whatsapp_contacts k
       set user_id = coalesce(k.user_id, v_user_id),
           -- A number another contact of the company already holds is not moved.
           wa_id = case
             when k.wa_id is null and v_wa_id is not null
                  and not exists (select 1 from public.whatsapp_contacts o where o.company_id = p_company_id and o.wa_id = v_wa_id)
               then v_wa_id
             else k.wa_id
           end,
           profile_name = coalesce(v_profile_name, k.profile_name),
           last_message_at = greatest(k.last_message_at, v_at)
     where k.id = v_contact.id
    returning * into v_contact;
  end if;

  -- A tenant of THIS company whose WhatsApp number is the contact's number. The number Meta reports is
  -- the sender's own, so the link holds whether or not LeaseGuard verified the tenant's number; linking
  -- is the cautious direction (tenants are never answered automatically). Several tenants with one
  -- number: the current one (not vacated), then the most recently added.
  if v_contact.tenant_id is null and v_contact.wa_id is not null then
    select t.id into v_tenant_id
    from public.tenants t
    where t.company_id = p_company_id and t.whatsapp_number = '+' || v_contact.wa_id
    order by (t.status = 'vacated'), t.created_at desc, t.id
    limit 1;
    if v_tenant_id is not null then
      update public.whatsapp_contacts k set tenant_id = v_tenant_id where k.id = v_contact.id
      returning * into v_contact;
    end if;
  end if;

  insert into public.whatsapp_conversations as w (company_id, number_id, contact_id, last_inbound_at, last_message_at)
  values (p_company_id, p_number_id, v_contact.id, v_at, v_at)
  on conflict (company_id, number_id, contact_id) do update
    set last_inbound_at = greatest(w.last_inbound_at, excluded.last_inbound_at),
        last_message_at = greatest(w.last_message_at, excluded.last_message_at)
  returning w.id into v_conversation_id;

  insert into public.communications (
    company_id, channel, direction, message_type, recipient_type, tenant_id, contact_id, conversation_id,
    counterparty_number, company_number, body, status, external_message_id, received_at
  )
  values (
    p_company_id, 'whatsapp', 'inbound', 'inbound_reply',
    case when v_contact.tenant_id is null then 'contact'::public.recipient_type else 'tenant'::public.recipient_type end,
    v_contact.tenant_id, v_contact.id, v_conversation_id,
    case when v_contact.wa_id is null then null else '+' || v_contact.wa_id end,
    v_company_number,
    left(coalesce(nullif(p_body, ''), '(Empty message)'), 4096),
    'received', p_provider_message_id, v_at
  )
  returning id into v_communication_id;

  return query select 'recorded'::text, v_communication_id, v_conversation_id, v_contact.id;
end;
$$;
revoke all on function public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz) to service_role;
comment on function public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz) is
  'Service role only. Records one inbound WhatsApp message for the company that owns the connected receiving number: dedupe by Meta message id, find or create the contact, link a same-company tenant, thread the conversation. Returns recorded | duplicate | unknown_number.';
