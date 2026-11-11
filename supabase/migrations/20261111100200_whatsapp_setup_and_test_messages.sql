-- WhatsApp setup progress, test messages and WhatsApp activation (ticket 11).
--
-- * whatsapp_setup_steps(company): the ten setup steps of a company, each computed from facts LeaseGuard verified
--   itself (Meta's answers recorded by the worker, LeaseGuard's own records), never from what an admin typed:
--     business_profile     the company profile's required fields are filled in
--     meta_account         the company is an account holder: a business token stored through WhatsApp signup, or a
--                          connected number
--     business_account     Meta confirmed the token covers a WhatsApp Business Account (number verification's
--                          token_scopes step passed), or a number is connected
--     phone_number         Meta lists the number in that account and it is registered for the Cloud API (steps
--                          phone_number and registration), or it is connected
--     webhook              Meta accepted LeaseGuard's webhook subscription for the account (subscribed_apps success)
--     message_templates    Meta approved at least one UTILITY template of the company
--     ai_agent             a company admin saved the AI agent configuration (recommended, not required)
--     knowledge_base       at least one approved FAQ, knowledge entry or document (recommended, not required)
--     test_message         a test message from a connected number reached delivered or read (Meta's status webhook)
--     ready_for_activation every required step is done
--   Each step is done, action_needed, waiting_on_meta or blocked (an earlier step must be done first).
-- * whatsapp_test_messages: a company admin sends one Meta-approved template from a connected number to a number they
--   enter (never a tenant of the company). The worker sends it; only Meta's delivered/read status completes the step.
-- * companies.whatsapp_activated_at: the company's WhatsApp go-live. A guard trigger refuses setting it, by any role,
--   while a required step is not done; company admins (de)activate through the functions below.

-- ------------------------------------------------------------------ test messages
create table public.whatsapp_test_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The company's number it is sent from.
  number_id uuid not null,
  -- The Meta template, as chosen (the synced catalogue is replaced on each sync, so the name and language are kept).
  template_name text not null check (length(template_name) between 1 and 512),
  template_language text not null check (length(template_language) between 1 and 20),
  to_number text not null check (to_number ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) between 1 and 200),
  -- For the admin: why it failed (Meta's code and title, or LeaseGuard's reason). Never a token.
  failure_reason text check (failure_reason is null or length(failure_reason) <= 2000),
  -- The send's outcome is unknown (Meta may have accepted it): never sent again automatically.
  may_have_been_sent boolean not null default false,
  requested_by_user_id uuid,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_test_messages_company_id_key unique (company_id, id),
  constraint whatsapp_test_messages_provider_message_key unique (company_id, provider_message_id),
  constraint whatsapp_test_messages_number_fk foreign key (company_id, number_id)
    references public.whatsapp_phone_numbers (company_id, id) on delete cascade,
  constraint whatsapp_test_messages_requested_by_fk foreign key (company_id, requested_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (requested_by_user_id),
  constraint whatsapp_test_messages_sent_check check (status in ('queued', 'sending', 'failed') or provider_message_id is not null),
  constraint whatsapp_test_messages_failed_check check ((status = 'failed') = (failed_at is not null))
);
comment on table public.whatsapp_test_messages is
  'Test messages company admins send from a connected number (an approved Meta template). Written by the request function and the worker.';
create index whatsapp_test_messages_company_created_idx on public.whatsapp_test_messages (company_id, created_at desc);
create index whatsapp_test_messages_number_idx on public.whatsapp_test_messages (company_id, number_id);
create index whatsapp_test_messages_requested_by_idx on public.whatsapp_test_messages (company_id, requested_by_user_id)
  where requested_by_user_id is not null;
create trigger set_updated_at before update on public.whatsapp_test_messages
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_test_messages
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_test_messages enable row level security;
revoke all on public.whatsapp_test_messages from anon, authenticated;
-- Company admins read their company's test messages (the recipient is a number an admin typed); nobody signed in writes.
grant select on public.whatsapp_test_messages to authenticated;
grant select, insert, update, delete on public.whatsapp_test_messages to service_role;
create policy admins_read on public.whatsapp_test_messages for select to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

-- A company admin asks for a test message. SECURITY DEFINER (members never write the table); it re-checks the caller is
-- an active company admin of the company. Outcomes: created | number_not_found | number_not_connected |
-- template_not_found | template_not_approved | tenant | rate_limited.
create function public.request_whatsapp_test_message(p_company_id uuid, p_number_id uuid, p_template_id uuid, p_to_number text)
returns table (outcome text, test_message_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_account text;
  v_connection public.whatsapp_connection_status;
  v_name text;
  v_language text;
  v_status text;
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can send a WhatsApp test message' using errcode = '42501';
  end if;
  if p_to_number is null or p_to_number !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'the recipient is a WhatsApp number in international format, e.g. +27821234567' using errcode = '22023';
  end if;

  select n.business_account_id, n.connection_status into v_account, v_connection
  from public.whatsapp_phone_numbers n where n.company_id = p_company_id and n.id = p_number_id;
  if v_account is null then
    return query select 'number_not_found'::text, null::uuid;
    return;
  end if;
  if v_connection <> 'connected' then
    return query select 'number_not_connected'::text, null::uuid;
    return;
  end if;

  select t.name, t.language, t.status into v_name, v_language, v_status
  from public.whatsapp_message_templates t
  where t.company_id = p_company_id and t.id = p_template_id and t.business_account_id = v_account;
  if v_name is null then
    return query select 'template_not_found'::text, null::uuid;
    return;
  end if;
  if v_status <> 'APPROVED' then
    return query select 'template_not_approved'::text, null::uuid;
    return;
  end if;

  -- Tenants only ever receive approved statement and payment messages (ADR 0001): never a test.
  if exists (select 1 from public.tenants t where t.company_id = p_company_id and t.whatsapp_number = p_to_number) then
    return query select 'tenant'::text, null::uuid;
    return;
  end if;

  -- Protects the number's quality rating: at most 10 test messages per company per hour.
  perform pg_advisory_xact_lock(hashtextextended('whatsapp_test_message:' || p_company_id::text, 0));
  if (select count(*) from public.whatsapp_test_messages m
      where m.company_id = p_company_id and m.created_at > now() - interval '1 hour') >= 10 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  insert into public.whatsapp_test_messages (company_id, number_id, template_name, template_language, to_number, requested_by_user_id)
  values (p_company_id, p_number_id, v_name, v_language, p_to_number, (select auth.uid()))
  returning id into v_id;
  return query select 'created'::text, v_id;
end;
$$;
revoke all on function public.request_whatsapp_test_message(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.request_whatsapp_test_message(uuid, uuid, uuid, text) to authenticated;
comment on function public.request_whatsapp_test_message(uuid, uuid, uuid, text) is
  'Company admins: a test message (an approved Meta template of the number''s account) from a connected number to a non-tenant number. Returns created | number_not_found | number_not_connected | template_not_found | template_not_approved | tenant | rate_limited.';

-- The API could not hand the test message to the worker (Redis unavailable): the admin who asked marks it failed.
create function public.abandon_whatsapp_test_message(p_company_id uuid, p_test_message_id uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can change a WhatsApp test message' using errcode = '42501';
  end if;
  update public.whatsapp_test_messages m
     set status = 'failed', failed_at = now(), failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Not sent'), 2000)
   where m.company_id = p_company_id and m.id = p_test_message_id and m.status = 'queued'
     and m.requested_by_user_id = (select auth.uid());
  return found;
end;
$$;
revoke all on function public.abandon_whatsapp_test_message(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.abandon_whatsapp_test_message(uuid, uuid, text) to authenticated;
comment on function public.abandon_whatsapp_test_message(uuid, uuid, text) is
  'The company admin who requested a queued test message marks it failed when it could not be queued for sending.';

-- Meta's status of a sent test message (the worker, from the status webhook): forward only along sent -> delivered ->
-- read, a late status only fills its time, failed only before any delivery evidence. Same outcomes as
-- record_communication_provider_status: advanced | recorded | unchanged | not_found.
create function public.record_whatsapp_test_message_status(
  p_company_id uuid,
  p_provider_message_id text,
  p_status text,
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
  v_status text;
  v_sent_at timestamptz;
  v_delivered_at timestamptz;
  v_read_at timestamptz;
  v_next text;
  v_rank_new integer;
  v_rank_old integer;
  v_fills_time boolean;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'a provider status is sent, delivered, read or failed' using errcode = '22023';
  end if;
  select m.id, m.status, m.sent_at, m.delivered_at, m.read_at into v_id, v_status, v_sent_at, v_delivered_at, v_read_at
  from public.whatsapp_test_messages m
  where m.company_id = p_company_id and m.provider_message_id = p_provider_message_id
  for update;
  if not found then
    return 'not_found';
  end if;

  v_rank_new := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  v_rank_old := case v_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  v_next := case
    when v_status = 'failed' then v_status
    when p_status = 'failed' then case when v_status = 'sent' then 'failed' else v_status end
    when v_rank_new > v_rank_old then p_status
    else v_status
  end;
  v_fills_time := (p_status = 'sent' and v_sent_at is null)
    or (p_status = 'delivered' and v_delivered_at is null)
    or (p_status = 'read' and v_read_at is null);
  if v_next = v_status and not v_fills_time then
    return 'unchanged';
  end if;

  update public.whatsapp_test_messages m
     set status = v_next,
         sent_at = case when p_status = 'sent' then coalesce(m.sent_at, v_at) else m.sent_at end,
         delivered_at = case when p_status = 'delivered' then coalesce(m.delivered_at, v_at) else m.delivered_at end,
         read_at = case when p_status = 'read' then coalesce(m.read_at, v_at) else m.read_at end,
         failed_at = case when v_next = 'failed' and v_status <> 'failed' then v_at else m.failed_at end,
         failure_reason = case
           when v_next = 'failed' and v_status <> 'failed'
             then left(coalesce(nullif(btrim(p_failure_reason), ''), 'WhatsApp reported that the message failed'), 2000)
           else m.failure_reason
         end
   where m.id = v_id;
  return case when v_next <> v_status then 'advanced' else 'recorded' end;
end;
$$;
revoke all on function public.record_whatsapp_test_message_status(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_test_message_status(uuid, text, text, timestamptz, text) to service_role;
comment on function public.record_whatsapp_test_message_status(uuid, text, text, timestamptz, text) is
  'Service role (worker): Meta''s status of a test message, forward only. Returns advanced | recorded | unchanged | not_found.';

-- ------------------------------------------------------------------ setup steps
-- The internal computation; callers check access. SECURITY DEFINER: it reads facts members cannot (the stored token
-- reference, every admin's signups). Returns step names, never values.
create function private.whatsapp_setup_steps(p_company_id uuid)
returns table (step text, step_order integer, required boolean, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile boolean;
  v_connected boolean;
  v_holder boolean;
  v_signup_open boolean;
  v_checking boolean;
  v_account boolean;
  v_number boolean;
  v_webhook boolean;
  v_templates boolean;
  v_templates_pending boolean;
  v_any_approved boolean;
  v_agent boolean;
  v_knowledge boolean;
  v_test boolean;
  v_test_waiting boolean;
  v_ready boolean;
begin
  select btrim(c.name) <> '' and btrim(c.contact_email) <> '' and btrim(c.contact_phone) <> ''
         and btrim(c.address_line1) <> '' and btrim(c.suburb) <> '' and btrim(c.city) <> '' and btrim(c.postal_code) <> ''
    into v_profile
  from public.companies c where c.id = p_company_id;
  v_profile := coalesce(v_profile, false);

  v_connected := exists (select 1 from public.whatsapp_phone_numbers n
                         where n.company_id = p_company_id and n.connection_status = 'connected');
  v_holder := v_connected or exists (select 1 from public.whatsapp_business_accounts a
                                     where a.company_id = p_company_id and a.access_token_reference is not null);
  v_signup_open := exists (select 1 from public.whatsapp_onboarding_sessions s
                           where s.company_id = p_company_id and s.status in ('started', 'code_received') and s.expires_at > now());
  -- A number verification that has not finished: a number pending verification with no result yet or a step pending.
  v_checking := exists (
    select 1 from public.whatsapp_phone_numbers n
    where n.company_id = p_company_id and n.connection_status = 'pending_verification'
      and (not exists (select 1 from public.whatsapp_number_verification_steps v where v.company_id = n.company_id and v.number_id = n.id)
           or exists (select 1 from public.whatsapp_number_verification_steps v
                      where v.company_id = n.company_id and v.number_id = n.id and v.status = 'pending')));

  v_account := v_connected or v_holder and exists (
    select 1 from public.whatsapp_number_verification_steps v
    join public.whatsapp_phone_numbers n on n.company_id = v.company_id and n.id = v.number_id
    where v.company_id = p_company_id and n.connection_status <> 'disconnected' and v.step = 'token_scopes' and v.status = 'passed');
  v_number := v_connected or exists (
    select 1 from public.whatsapp_phone_numbers n
    where n.company_id = p_company_id and n.connection_status <> 'disconnected'
      and exists (select 1 from public.whatsapp_number_verification_steps v
                  where v.company_id = n.company_id and v.number_id = n.id and v.step = 'phone_number' and v.status = 'passed')
      and exists (select 1 from public.whatsapp_number_verification_steps v
                  where v.company_id = n.company_id and v.number_id = n.id and v.step = 'registration'
                    and v.status in ('passed', 'not_required')));
  v_webhook := exists (
    select 1 from public.whatsapp_phone_numbers n
    where n.company_id = p_company_id and n.connection_status <> 'disconnected'
      and ((n.connection_status = 'connected' and n.webhook_configured)
           or exists (select 1 from public.whatsapp_number_verification_steps v
                      where v.company_id = n.company_id and v.number_id = n.id and v.step = 'webhook_subscription' and v.status = 'passed')));
  v_templates := exists (select 1 from public.whatsapp_message_templates t
                         where t.company_id = p_company_id and upper(t.category) = 'UTILITY' and t.status = 'APPROVED');
  v_templates_pending := exists (select 1 from public.whatsapp_message_templates t
                                 where t.company_id = p_company_id and t.status in ('PENDING', 'IN_APPEAL'));
  v_any_approved := exists (select 1 from public.whatsapp_message_templates t
                            join public.whatsapp_phone_numbers n
                              on n.company_id = t.company_id and n.business_account_id = t.business_account_id and n.connection_status = 'connected'
                            where t.company_id = p_company_id and t.status = 'APPROVED');

  v_agent := exists (select 1 from public.whatsapp_agent_configs g where g.company_id = p_company_id);
  v_knowledge := exists (select 1 from public.whatsapp_knowledge_faqs f where f.company_id = p_company_id and f.status = 'approved')
    or exists (select 1 from public.whatsapp_knowledge_entries e where e.company_id = p_company_id and e.status = 'approved')
    or exists (select 1 from public.whatsapp_knowledge_documents d where d.company_id = p_company_id and d.status = 'approved');

  v_test := exists (select 1 from public.whatsapp_test_messages m
                    join public.whatsapp_phone_numbers n on n.company_id = m.company_id and n.id = m.number_id
                    where m.company_id = p_company_id and m.status in ('delivered', 'read') and n.connection_status = 'connected');
  v_test_waiting := coalesce((select m.status in ('queued', 'sending', 'sent') from public.whatsapp_test_messages m
                              where m.company_id = p_company_id order by m.created_at desc, m.id desc limit 1), false);

  v_ready := v_profile and v_holder and v_account and v_number and v_webhook and v_templates and v_test;

  return query values
    ('business_profile', 1, true, case when v_profile then 'done' else 'action_needed' end),
    ('meta_account', 2, true, case when v_holder then 'done' when v_signup_open then 'waiting_on_meta' else 'action_needed' end),
    ('business_account', 3, true, case when v_account then 'done' when not v_holder then 'blocked'
                                       when v_checking then 'waiting_on_meta' else 'action_needed' end),
    ('phone_number', 4, true, case when v_number then 'done' when not v_account then 'blocked'
                                   when v_checking then 'waiting_on_meta' else 'action_needed' end),
    ('webhook', 5, true, case when v_webhook then 'done' when not v_account then 'blocked'
                              when v_checking then 'waiting_on_meta' else 'action_needed' end),
    ('message_templates', 6, true, case when v_templates then 'done' when not v_account then 'blocked'
                                        when v_templates_pending or v_checking then 'waiting_on_meta' else 'action_needed' end),
    ('ai_agent', 7, false, case when v_agent then 'done' else 'action_needed' end),
    ('knowledge_base', 8, false, case when v_knowledge then 'done' else 'action_needed' end),
    ('test_message', 9, true, case when v_test then 'done' when not (v_connected and v_any_approved) then 'blocked'
                                   when v_test_waiting then 'waiting_on_meta' else 'action_needed' end),
    ('ready_for_activation', 10, true, case when v_ready then 'done' else 'blocked' end);
end;
$$;
revoke all on function private.whatsapp_setup_steps(uuid) from public, anon, authenticated;
grant execute on function private.whatsapp_setup_steps(uuid) to service_role;

create function private.whatsapp_setup_ready(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.state = 'done' from private.whatsapp_setup_steps(p_company_id) s where s.step = 'ready_for_activation'), false)
$$;
revoke all on function private.whatsapp_setup_ready(uuid) from public, anon, authenticated;
grant execute on function private.whatsapp_setup_ready(uuid) to service_role;

-- Members of the company read its setup steps (the API's GET .../setup). Another company's id gives 42501.
create function public.whatsapp_setup_status(p_company_id uuid)
returns table (step text, step_order integer, required boolean, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not (p_company_id = any (private.member_company_ids())) then
    raise exception 'Only members of the company can read its WhatsApp setup' using errcode = '42501';
  end if;
  return query select s.step, s.step_order, s.required, s.state from private.whatsapp_setup_steps(p_company_id) s order by s.step_order;
end;
$$;
revoke all on function public.whatsapp_setup_status(uuid) from public, anon, service_role;
grant execute on function public.whatsapp_setup_status(uuid) to authenticated;
comment on function public.whatsapp_setup_status(uuid) is
  'Members: the ten WhatsApp setup steps of the company, computed from verified facts only (done | action_needed | waiting_on_meta | blocked).';

-- ------------------------------------------------------------------ activation
alter table public.companies
  add column whatsapp_activated_at timestamptz,
  -- The admin who activated it (auth.uid() at the time). No foreign key: a second relationship between companies and
  -- company_users would make the Data API's companies <-> company_users embeds ambiguous (PGRST201).
  add column whatsapp_activated_by_user_id uuid,
  add constraint companies_whatsapp_activated_by_check check (whatsapp_activated_at is not null or whatsapp_activated_by_user_id is null);
comment on column public.companies.whatsapp_activated_at is
  'When a company admin activated WhatsApp for the company. Only settable while every required setup step is verified (guard trigger).';

-- Every role, the service role included: a company is never marked active for WhatsApp unless its required steps are done.
create function private.guard_whatsapp_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.whatsapp_activated_at is not null
     and (tg_op = 'INSERT' or old.whatsapp_activated_at is null)
     and not private.whatsapp_setup_ready(new.id) then
    raise exception 'WhatsApp cannot be activated until every required setup step is verified' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_activation() from public, anon, authenticated;
create trigger guard_whatsapp_activation before insert or update of whatsapp_activated_at on public.companies
  for each row execute function private.guard_whatsapp_activation();

-- Company admins. Outcomes: activated | already_active | not_ready.
create function public.activate_company_whatsapp(p_company_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can activate WhatsApp' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies c where c.id = p_company_id and c.whatsapp_activated_at is not null) then
    return 'already_active';
  end if;
  if not private.whatsapp_setup_ready(p_company_id) then
    return 'not_ready';
  end if;
  update public.companies c set whatsapp_activated_at = now(), whatsapp_activated_by_user_id = (select auth.uid())
   where c.id = p_company_id;
  return 'activated';
end;
$$;
revoke all on function public.activate_company_whatsapp(uuid) from public, anon, service_role;
grant execute on function public.activate_company_whatsapp(uuid) to authenticated;
comment on function public.activate_company_whatsapp(uuid) is
  'Company admins: activate WhatsApp for the company once every required setup step is verified. Returns activated | already_active | not_ready.';

-- Company admins. Returns whether it was active.
create function public.deactivate_company_whatsapp(p_company_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can deactivate WhatsApp' using errcode = '42501';
  end if;
  update public.companies c set whatsapp_activated_at = null, whatsapp_activated_by_user_id = null
   where c.id = p_company_id and c.whatsapp_activated_at is not null;
  return found;
end;
$$;
revoke all on function public.deactivate_company_whatsapp(uuid) from public, anon, service_role;
grant execute on function public.deactivate_company_whatsapp(uuid) to authenticated;
comment on function public.deactivate_company_whatsapp(uuid) is
  'Company admins: mark WhatsApp as not active for the company. Returns whether it was active.';
