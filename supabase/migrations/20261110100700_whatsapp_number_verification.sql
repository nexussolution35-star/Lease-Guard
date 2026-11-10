-- Number verification: a business number is connected only after LeaseGuard verified it with Meta.
--
-- After Embedded Signup (20261110100600) a number is 'pending_verification'. The worker then verifies it in
-- five steps and records each one in whatsapp_number_verification_steps:
--   token_scopes          Meta's debug_token: the business token is valid and its granular scopes cover the
--                         number's WhatsApp Business Account for management and messaging;
--   phone_number          the number belongs to that account; Meta's view of it is recorded on the number;
--   webhook_subscription  LeaseGuard's app is subscribed to the account's webhooks (subscribed_apps);
--   registration          the number is registered for the Cloud API (the admin's 6-digit PIN, never stored),
--                         or registration is not required (WhatsApp Business app number, or already registered);
--   message_templates     the account's message templates are synced into whatsapp_message_templates.
-- finish_whatsapp_number_verification then decides the number's status from the recorded steps, in one
-- statement: 'connected' only when every step passed (or is not required), 'error' when a step failed,
-- 'pending_verification' while a step waits for the admin (the PIN). Partial success therefore always shows
-- which step failed.
--
-- * Step rows, Meta's template catalogue and the registration lock are written by the service role (worker)
--   only; members of the company read them; other companies and anon see nothing.
-- * Meta locks registration for 72 hours after 10 attempts (error 133016): the worker records
--   registration_blocked_until, and the API refuses new attempts until then (no retry storm).
-- * Template sync also reflects Meta's status onto the company's own message_templates with the same Meta
--   name and language (approval_status), which the outbound gate already requires to be 'approved'. A company
--   template Meta no longer holds in any of the company's accounts goes back to 'draft'.
-- * disconnect_whatsapp_number (company admins): marks the number disconnected, drops its credential and
--   deletes the vault secret once no number of the company in use holds that token any more.

create type public.whatsapp_verification_step as enum (
  'token_scopes', 'phone_number', 'webhook_subscription', 'registration', 'message_templates'
);
create type public.whatsapp_verification_step_status as enum (
  'pending', 'passed', 'failed', 'action_needed', 'not_required'
);

-- ------------------------------------------------------------------ numbers
alter table public.whatsapp_phone_numbers
  add constraint whatsapp_phone_numbers_company_id_key unique (company_id, id);
alter table public.whatsapp_phone_numbers
  add column registration_blocked_until timestamptz;
comment on column public.whatsapp_phone_numbers.registration_blocked_until is
  'Meta refused registration after too many attempts (error 133016, 10 per 72 hours); no new attempt before this time (service role only).';
grant select (registration_blocked_until) on public.whatsapp_phone_numbers to authenticated;

-- ------------------------------------------------------------------ verification steps
create table public.whatsapp_number_verification_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number_id uuid not null,
  step public.whatsapp_verification_step not null,
  status public.whatsapp_verification_step_status not null default 'pending',
  -- Written for the admin: what happened and how to recover. Never a token, PIN or secret.
  message text check (message is null or length(message) <= 1000),
  recovery text check (recovery is null or length(recovery) <= 1000),
  meta_error_code text check (meta_error_code is null or length(meta_error_code) <= 40),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_number_verification_steps_number_step_key unique (number_id, step),
  constraint whatsapp_number_verification_steps_number_fkey
    foreign key (company_id, number_id) references public.whatsapp_phone_numbers (company_id, id) on delete cascade
);
comment on table public.whatsapp_number_verification_steps is
  'The outcome of each verification step of a business number (worker only writes). A number is connected only when every step passed.';
create index whatsapp_number_verification_steps_company_number_idx
  on public.whatsapp_number_verification_steps (company_id, number_id);

create trigger set_updated_at before update on public.whatsapp_number_verification_steps
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_number_verification_steps
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_number_verification_steps enable row level security;
grant select on public.whatsapp_number_verification_steps to authenticated;
grant select, insert, update, delete on public.whatsapp_number_verification_steps to service_role;
create policy members_read on public.whatsapp_number_verification_steps for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- ------------------------------------------------------------------ Meta's message templates
create table public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  business_account_id text not null,
  meta_template_id text not null check (meta_template_id ~ '^[0-9]{1,32}$'),
  name text not null check (length(name) between 1 and 512),
  language text not null check (length(language) between 1 and 20),
  -- Meta's values, e.g. UTILITY / MARKETING / AUTHENTICATION and APPROVED / PENDING / REJECTED / PAUSED.
  category text not null check (length(category) between 1 and 40),
  status text not null check (length(status) between 1 and 40),
  rejected_reason text check (rejected_reason is null or length(rejected_reason) <= 200),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_message_templates_meta_key unique (company_id, business_account_id, meta_template_id),
  constraint whatsapp_message_templates_business_account_fkey
    foreign key (company_id, business_account_id)
    references public.whatsapp_business_accounts (company_id, business_account_id) on delete cascade
);
comment on table public.whatsapp_message_templates is
  'Message templates Meta holds for a company''s WhatsApp Business Account, as last synced by the worker (read-only for members).';

create trigger set_updated_at before update on public.whatsapp_message_templates
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_message_templates
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_message_templates enable row level security;
grant select on public.whatsapp_message_templates to authenticated;
grant select, insert, update, delete on public.whatsapp_message_templates to service_role;
create policy members_read on public.whatsapp_message_templates for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- ------------------------------------------------------------------ admin edits drop earlier results
-- An admin who changes a number's Meta ids (PUT /companies/:id/whatsapp) gets a different number: earlier
-- step results and the registration lock described the old one. SECURITY DEFINER because signed-in users
-- cannot write either.
create function private.reset_whatsapp_number_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.business_account_id, new.phone_number_id) is distinct from (old.business_account_id, old.phone_number_id) then
    delete from public.whatsapp_number_verification_steps s where s.company_id = new.company_id and s.number_id = new.id;
    if new.phone_number_id is distinct from old.phone_number_id then
      update public.whatsapp_phone_numbers set registration_blocked_until = null where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.reset_whatsapp_number_verification() from public;

create trigger reset_verification after update of business_account_id, phone_number_id
  on public.whatsapp_phone_numbers
  for each row execute function private.reset_whatsapp_number_verification();

-- ------------------------------------------------------------------ worker: decide the status
-- Service role only. Reads the number's recorded steps and sets its status in one statement:
-- 'connected' when every step passed or is not required (also webhook_configured and last_verified_at, and the
-- Embedded Signup session that brought the number becomes 'completed'); 'error' when a step failed;
-- 'pending_verification' otherwise. A number another company holds connected is never connected here: its
-- phone_number step is failed instead. A number disconnected meanwhile stays disconnected.
create function public.finish_whatsapp_number_verification(p_company_id uuid, p_number_id uuid)
returns public.whatsapp_connection_status
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_number public.whatsapp_phone_numbers;
  v_ok integer;
  v_failed integer;
  v_webhook boolean;
begin
  select * into v_number from public.whatsapp_phone_numbers n
  where n.company_id = p_company_id and n.id = p_number_id
  for update;
  if not found then
    raise exception 'The WhatsApp number was not found' using errcode = 'P0002';
  end if;
  if v_number.connection_status = 'disconnected' then
    delete from public.whatsapp_number_verification_steps s where s.company_id = p_company_id and s.number_id = p_number_id;
    return 'disconnected';
  end if;

  if exists (select 1 from public.whatsapp_phone_numbers o
             where o.phone_number_id = v_number.phone_number_id and o.connection_status = 'connected' and o.id <> v_number.id) then
    insert into public.whatsapp_number_verification_steps as s (company_id, number_id, step, status, message, recovery, checked_at)
    values (p_company_id, p_number_id, 'phone_number', 'failed',
            'This number is already connected to another LeaseGuard workspace.',
            'A number can be connected to one workspace only. Disconnect it there first, or contact Nexus Solution support.',
            now())
    on conflict (number_id, step) do update
    set status = excluded.status, message = excluded.message, recovery = excluded.recovery, meta_error_code = null,
        checked_at = excluded.checked_at;
  end if;

  select count(*) filter (where s.status in ('passed', 'not_required')),
         count(*) filter (where s.status = 'failed'),
         coalesce(bool_or(s.step = 'webhook_subscription' and s.status = 'passed'), false)
  into v_ok, v_failed, v_webhook
  from public.whatsapp_number_verification_steps s
  where s.company_id = p_company_id and s.number_id = p_number_id;

  if v_ok = cardinality(enum_range(null::public.whatsapp_verification_step)) then
    update public.whatsapp_phone_numbers
    set connection_status = 'connected', webhook_configured = true, last_verified_at = now()
    where id = p_number_id;
    update public.whatsapp_onboarding_sessions s
    set status = 'completed'
    where s.company_id = p_company_id and s.phone_number_id = v_number.phone_number_id and s.status = 'exchanged';
    return 'connected';
  end if;

  update public.whatsapp_phone_numbers
  set connection_status = case when v_failed > 0 then 'error' else 'pending_verification' end::public.whatsapp_connection_status,
      webhook_configured = v_webhook
  where id = p_number_id;
  return case when v_failed > 0 then 'error' else 'pending_verification' end::public.whatsapp_connection_status;
end;
$$;
revoke all on function public.finish_whatsapp_number_verification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_whatsapp_number_verification(uuid, uuid) to service_role;
comment on function public.finish_whatsapp_number_verification(uuid, uuid) is
  'Service role (worker): sets a number connected only when every verification step passed, else error or pending_verification.';

-- ------------------------------------------------------------------ worker: template sync
-- Service role only. Replaces the account's synced templates with p_templates (a JSON array of Meta template
-- objects: id, name, language, category, status, rejected_reason) and reflects Meta's status onto the
-- company's own message_templates with the same Meta name and language: APPROVED -> approved; PENDING and
-- IN_APPEAL -> submitted; any other status (REJECTED, PAUSED, DISABLED, ...) -> rejected, because Meta will not
-- send it. A company template that was approved or submitted but whose Meta name and language no account of the
-- company holds any more (deleted in Meta, or never in these accounts) goes back to 'draft': Meta would refuse to
-- send it, so the outbound gate must stop treating it as approved. Templates of the company's other accounts
-- count, so a sync of one account never downgrades a template another account holds. Returns the number of
-- templates now recorded for the account.
create function public.sync_whatsapp_message_templates(p_company_id uuid, p_business_account_id text, p_templates jsonb)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'Templates must be a JSON array' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.synced_templates (
    meta_template_id text, name text, language text, category text, status text, rejected_reason text
  ) on commit drop;
  truncate pg_temp.synced_templates;
  insert into pg_temp.synced_templates
  select t.id, t.name, t.language, upper(t.category), upper(t.status),
         nullif(left(nullif(t.rejected_reason, 'NONE'), 200), '')
  from jsonb_to_recordset(p_templates) as t (id text, name text, language text, category text, status text, rejected_reason text);

  insert into public.whatsapp_message_templates as w
    (company_id, business_account_id, meta_template_id, name, language, category, status, rejected_reason, synced_at)
  select p_company_id, p_business_account_id, t.meta_template_id, t.name, t.language, t.category, t.status, t.rejected_reason, now()
  from pg_temp.synced_templates t
  on conflict (company_id, business_account_id, meta_template_id) do update
  set name = excluded.name, language = excluded.language, category = excluded.category, status = excluded.status,
      rejected_reason = excluded.rejected_reason, synced_at = excluded.synced_at;

  delete from public.whatsapp_message_templates w
  where w.company_id = p_company_id and w.business_account_id = p_business_account_id
    and not exists (select 1 from pg_temp.synced_templates t where t.meta_template_id = w.meta_template_id);

  update public.message_templates m
  set approval_status = case
        when t.status = 'APPROVED' then 'approved'
        when t.status in ('PENDING', 'IN_APPEAL') then 'submitted'
        else 'rejected'
      end::public.template_approval_status
  from pg_temp.synced_templates t
  where m.company_id = p_company_id and m.meta_template_name = t.name and m.language = t.language
    and m.approval_status is distinct from (case
        when t.status = 'APPROVED' then 'approved'
        when t.status in ('PENDING', 'IN_APPEAL') then 'submitted'
        else 'rejected'
      end::public.template_approval_status);

  update public.message_templates m
  set approval_status = 'draft'
  where m.company_id = p_company_id
    and m.meta_template_name is not null
    and m.approval_status in ('approved', 'submitted')
    and not exists (select 1 from public.whatsapp_message_templates w
                    where w.company_id = p_company_id and w.name = m.meta_template_name and w.language = m.language);

  select count(*) into v_count from pg_temp.synced_templates;
  return v_count;
end;
$$;
revoke all on function public.sync_whatsapp_message_templates(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_message_templates(uuid, text, jsonb) to service_role;
comment on function public.sync_whatsapp_message_templates(uuid, text, jsonb) is
  'Service role (worker): replaces an account''s synced Meta templates and reflects their status onto the company''s message_templates.';

-- ------------------------------------------------------------------ company admins: disconnect
-- Marks the number disconnected (it can no longer send or receive), drops its credential and its verification
-- results, and removes the business token. The decision follows the token, not the account: an account shared
-- with other numbers may hold this number's token while those numbers use another one (an env token, or the
-- token of a later Embedded Signup). Every account of the company stops referencing the token once no number
-- of the company still in use (not disconnected) holds it, and the vault secret is then deleted when nothing of
-- the company references it. A token another number in use still holds is kept (token_removed = false), and so
-- is an env token (the worker's own variable). Returns 'not_found' for a number that is not the company's.
-- SECURITY DEFINER because signed-in users cannot write these columns or Vault.
create function public.disconnect_whatsapp_number(p_company_id uuid, p_number_id uuid)
returns table (outcome text, token_removed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_number public.whatsapp_phone_numbers;
  v_secret uuid;
  v_removed boolean := false;
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can disconnect WhatsApp numbers' using errcode = '42501';
  end if;
  select * into v_number from public.whatsapp_phone_numbers n
  where n.company_id = p_company_id and n.id = p_number_id
  for update;
  if not found then
    return query select 'not_found'::text, false;
    return;
  end if;

  -- The env form (secret://env/...) is the worker's own variable and cannot be removed from here.
  if starts_with(v_number.access_token_reference, 'secret://vault/') then
    v_secret := substr(v_number.access_token_reference, length('secret://vault/') + 1)::uuid;
  end if;

  update public.whatsapp_phone_numbers
  set connection_status = 'disconnected', webhook_configured = false, last_verified_at = null,
      access_token_reference = null  -- prepare_whatsapp_account turns it into the company's env form
  where id = p_number_id;
  delete from public.whatsapp_number_verification_steps s where s.company_id = p_company_id and s.number_id = p_number_id;

  update public.whatsapp_business_accounts a
  set access_token_reference = null
  where a.company_id = p_company_id
    and a.access_token_reference = v_number.access_token_reference
    and not exists (select 1 from public.whatsapp_phone_numbers n
                    where n.company_id = p_company_id and n.access_token_reference = v_number.access_token_reference
                      and n.connection_status <> 'disconnected');

  if v_secret is not null
     and not exists (select 1 from public.whatsapp_business_accounts a
                     where a.company_id = p_company_id and a.access_token_reference = v_number.access_token_reference)
     and not exists (select 1 from public.whatsapp_phone_numbers n
                     where n.company_id = p_company_id and n.access_token_reference = v_number.access_token_reference) then
    delete from vault.secrets s
    where s.id = v_secret
      and (s.name = 'whatsapp_access_token:' || p_company_id::text
           or starts_with(s.name, 'whatsapp_access_token:' || p_company_id::text || ':'));
    v_removed := found;
  end if;

  return query select 'disconnected'::text, v_removed;
end;
$$;
revoke all on function public.disconnect_whatsapp_number(uuid, uuid) from public, anon;
grant execute on function public.disconnect_whatsapp_number(uuid, uuid) to authenticated;
comment on function public.disconnect_whatsapp_number(uuid, uuid) is
  'Company admins: disconnects a WhatsApp number of the company and removes its stored token when no number in use holds it.';
