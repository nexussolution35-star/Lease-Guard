-- Meta Embedded Signup: onboarding sessions and storing each business's token in Supabase Vault.
--
-- A company admin connects WhatsApp Business through Meta's Embedded Signup popup. LeaseGuard:
--   1. starts an onboarding session (start_whatsapp_onboarding): single-use, expires after 15 minutes,
--      bound to the admin who started it and the company it was started for. The browser receives a random
--      state once; only its SHA-256 is stored.
--   2. records what the popup reported (record_whatsapp_onboarding_result): CANCEL and ERROR end the session
--      ('cancelled' / 'failed'), FINISH without a code ends it 'failed' (Meta returns the code only when the
--      customer clicks Finish), FINISH with a code moves it to 'code_received' so only one request can exchange
--      that code.
--   3. the API exchanges the code with Meta immediately (it lives about 30 seconds) and hands the business
--      token to store_whatsapp_onboarding_token, which writes it into Vault for that company only, records the
--      shared WhatsApp Business Accounts and the number as pending verification, points them at the secret
--      and marks the session 'exchanged', in one transaction. A failed exchange ends the session 'failed'
--      (fail_whatsapp_onboarding_exchange).
--
-- The API never holds the service-role key, so these are SECURITY DEFINER functions callable by signed-in
-- users. Each one checks that the caller is still an active company_admin of the session's company and is the
-- admin who started it; anyone else gets 'not_found' (nothing tells them whether the session exists). Signed-in
-- users have no write privilege on the sessions table itself.
--
-- Verification with Meta (token scopes, webhook subscription, registration, templates) is a later step: a
-- number stored here stays 'pending_verification' until the worker verifies it. 'completed' is reserved for
-- that step.

create type public.whatsapp_onboarding_status as enum (
  'started', 'code_received', 'exchanged', 'completed', 'cancelled', 'failed', 'expired'
);

create table public.whatsapp_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  started_by uuid not null references public.profiles (id) on delete cascade,
  -- SHA-256 (hex) of the state handed to the browser; never readable by signed-in users.
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  status public.whatsapp_onboarding_status not null default 'started',
  expires_at timestamptz not null default now() + interval '15 minutes',
  -- What Meta's popup reported (WA_EMBEDDED_SIGNUP message), normalised by the API.
  event text check (event in ('FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH_GRANT_ONLY_API_ACCESS',
                                 'CANCEL', 'ERROR')),
  embedded_signup_version text check (embedded_signup_version in ('v4', 'v5')),
  business_portfolio_id text check (business_portfolio_id ~ '^[0-9]{1,32}$'),
  messaging_account_ids text[] not null default '{}'
    check (cardinality(messaging_account_ids) <= 20
           and array_to_string(messaging_account_ids, ',') ~ '^([0-9]{1,32}(,[0-9]{1,32})*)?$'),
  phone_number_id text check (phone_number_id ~ '^[0-9]{1,32}$'),
  is_on_business_app boolean,
  current_step text check (length(current_step) <= 100),
  meta_error_code text check (length(meta_error_code) <= 40),
  meta_error_message text check (length(meta_error_message) <= 500),
  meta_session_id text check (length(meta_session_id) <= 200),
  -- Written for the admin: what happened and how to recover. Never a token, code or secret.
  error_message text check (length(error_message) <= 1000),
  code_received_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.whatsapp_onboarding_sessions is
  'Meta Embedded Signup attempts. Single-use, expiring, owned by the company admin who started them. Written only through the *_whatsapp_onboarding_* functions.';

create index whatsapp_onboarding_sessions_company_idx on public.whatsapp_onboarding_sessions (company_id, created_at desc);
create index whatsapp_onboarding_sessions_starter_idx on public.whatsapp_onboarding_sessions (started_by);

create trigger set_updated_at before update on public.whatsapp_onboarding_sessions
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_onboarding_sessions
  for each row execute function private.prevent_company_change();

alter table public.whatsapp_onboarding_sessions enable row level security;
grant select (id, company_id, started_by, status, expires_at, event, embedded_signup_version, business_portfolio_id,
              messaging_account_ids, phone_number_id, is_on_business_app, current_step, meta_error_code,
              meta_error_message, meta_session_id, error_message, code_received_at, finished_at, created_at, updated_at)
  on public.whatsapp_onboarding_sessions to authenticated;
grant select, insert, update, delete on public.whatsapp_onboarding_sessions to service_role;
create policy admins_read on public.whatsapp_onboarding_sessions for select to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));

-- ------------------------------------------------------------------ token reference per business account
-- The business token of an Embedded Signup covers the shared WhatsApp Business Accounts; each account records
-- the vault secret, and so does each number (the worker reads a number's token with
-- whatsapp_account_access_token). Never readable by signed-in users.
alter table public.whatsapp_business_accounts
  add column access_token_reference text
    check (access_token_reference is null or private.is_whatsapp_token_reference(access_token_reference, company_id));
comment on column public.whatsapp_business_accounts.access_token_reference is
  'secret://vault/<id> of the business token Embedded Signup stored for this account (service role and the onboarding functions only).';
revoke select on public.whatsapp_business_accounts from authenticated;
grant select (id, company_id, business_account_id, name, created_at, updated_at)
  on public.whatsapp_business_accounts to authenticated;

-- ------------------------------------------------------------------ helpers
-- The caller's session, when the caller started it, is still an active company_admin of its company, the
-- company is the one the request names and the state matches. Locks the row. Null otherwise.
create function private.own_whatsapp_onboarding_session(p_company_id uuid, p_session_id uuid, p_state text)
returns public.whatsapp_onboarding_sessions
language sql
security definer
set search_path = ''
as $$
  select s.*
  from public.whatsapp_onboarding_sessions s
  where s.id = p_session_id
    and s.company_id = p_company_id
    and s.started_by = (select auth.uid())
    and private.has_company_role(s.company_id, '{company_admin}')
    and (p_state is null or s.state_hash = encode(sha256(convert_to(p_state, 'UTF8')), 'hex'))
  for update
$$;
revoke all on function private.own_whatsapp_onboarding_session(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ 1. start
create function public.start_whatsapp_onboarding(p_company_id uuid)
returns table (session_id uuid, state text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_expires timestamptz;
begin
  if (select auth.uid()) is null or not private.has_company_role(p_company_id, '{company_admin}') then
    raise exception 'Only company admins can connect WhatsApp Business' using errcode = '42501';
  end if;
  -- One open signup per admin and company: an earlier one that was never finished can no longer be used.
  update public.whatsapp_onboarding_sessions s
  set status = 'expired', finished_at = now(),
      error_message = 'A newer WhatsApp signup was started, so this one can no longer be completed.'
  where s.company_id = p_company_id and s.started_by = (select auth.uid()) and s.status = 'started';

  insert into public.whatsapp_onboarding_sessions (company_id, started_by, state_hash)
  values (p_company_id, (select auth.uid()), encode(sha256(convert_to(v_state, 'UTF8')), 'hex'))
  returning id, whatsapp_onboarding_sessions.expires_at into v_id, v_expires;
  return query select v_id, v_state, v_expires;
end;
$$;
revoke all on function public.start_whatsapp_onboarding(uuid) from public, anon;
grant execute on function public.start_whatsapp_onboarding(uuid) to authenticated;
comment on function public.start_whatsapp_onboarding(uuid) is
  'Company admins: starts a single-use Embedded Signup session (15 minutes) and returns its state once.';

-- ------------------------------------------------------------------ 2. record the popup's result
-- p_status: 'cancelled' (CANCEL), 'failed' (ERROR, FINISH without a code or without account ids) or
-- 'code_received' (FINISH with a code: the API exchanges it next). Returns 'recorded', 'not_found',
-- 'expired' (the session is now marked expired) or 'already_used'.
create function public.record_whatsapp_onboarding_result(
  p_company_id uuid,
  p_session_id uuid,
  p_state text,
  p_status public.whatsapp_onboarding_status,
  p_event text,
  p_embedded_signup_version text default null,
  p_business_portfolio_id text default null,
  p_messaging_account_ids text[] default '{}',
  p_phone_number_id text default null,
  p_is_on_business_app boolean default null,
  p_current_step text default null,
  p_meta_error_code text default null,
  p_meta_error_message text default null,
  p_meta_session_id text default null,
  p_error_message text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.whatsapp_onboarding_sessions;
begin
  if p_status not in ('cancelled', 'failed', 'code_received') then
    raise exception 'An Embedded Signup result is cancelled, failed or code_received' using errcode = '22023';
  end if;
  if p_state is null then
    return 'not_found';
  end if;
  v_session := private.own_whatsapp_onboarding_session(p_company_id, p_session_id, p_state);
  if v_session.id is null then
    return 'not_found';
  end if;
  -- A session that expired, or that a newer signup by the same admin superseded, is reported as expired
  -- (not as already used) so the admin is told to start again rather than that it was completed.
  if v_session.status = 'expired' then
    return 'expired';
  end if;
  if v_session.status <> 'started' then
    return 'already_used';
  end if;
  if v_session.expires_at <= now() then
    update public.whatsapp_onboarding_sessions
    set status = 'expired', finished_at = now(),
        error_message = 'This WhatsApp signup expired before it was completed. Start again with Connect WhatsApp Business.'
    where id = v_session.id;
    return 'expired';
  end if;

  update public.whatsapp_onboarding_sessions
  set status = p_status,
      event = p_event,
      embedded_signup_version = p_embedded_signup_version,
      business_portfolio_id = p_business_portfolio_id,
      messaging_account_ids = coalesce(p_messaging_account_ids, '{}'),
      phone_number_id = p_phone_number_id,
      is_on_business_app = p_is_on_business_app,
      current_step = p_current_step,
      meta_error_code = p_meta_error_code,
      meta_error_message = p_meta_error_message,
      meta_session_id = p_meta_session_id,
      error_message = p_error_message,
      code_received_at = case when p_status = 'code_received' then now() end,
      finished_at = case when p_status = 'code_received' then null else now() end
  where id = v_session.id;
  return 'recorded';
end;
$$;
revoke all on function public.record_whatsapp_onboarding_result(uuid, uuid, text, public.whatsapp_onboarding_status, text, text, text,
  text[], text, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.record_whatsapp_onboarding_result(uuid, uuid, text, public.whatsapp_onboarding_status, text, text, text,
  text[], text, boolean, text, text, text, text, text) to authenticated;
comment on function public.record_whatsapp_onboarding_result(uuid, uuid, text, public.whatsapp_onboarding_status, text, text, text,
  text[], text, boolean, text, text, text, text, text) is
  'Company admin who started the session: records the Embedded Signup popup result once (single-use, unexpired).';

-- ------------------------------------------------------------------ 3a. a failed code exchange
create function public.fail_whatsapp_onboarding_exchange(p_company_id uuid, p_session_id uuid, p_error_message text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.whatsapp_onboarding_sessions;
begin
  v_session := private.own_whatsapp_onboarding_session(p_company_id, p_session_id, null);
  if v_session.id is null then
    return 'not_found';
  end if;
  if v_session.status <> 'code_received' then
    return 'already_used';
  end if;
  update public.whatsapp_onboarding_sessions
  set status = 'failed', finished_at = now(), error_message = p_error_message
  where id = v_session.id;
  return 'recorded';
end;
$$;
revoke all on function public.fail_whatsapp_onboarding_exchange(uuid, uuid, text) from public, anon;
grant execute on function public.fail_whatsapp_onboarding_exchange(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ 3b. store the business token
-- Writes the token into Vault, named for the session's company (whatsapp_account_access_token only resolves
-- secrets named for the number's own company), records the shared accounts and the number as pending
-- verification and points them at the secret, then marks the session exchanged. Earlier Embedded Signup
-- secrets of the company that nothing references any more are deleted. The token is never returned.
create function public.store_whatsapp_onboarding_token(p_company_id uuid, p_session_id uuid, p_access_token text)
returns table (business_account_id text, phone_number_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.whatsapp_onboarding_sessions;
  v_secret uuid;
  v_reference text;
  v_prefix text;
begin
  v_session := private.own_whatsapp_onboarding_session(p_company_id, p_session_id, null);
  if v_session.id is null then
    raise exception 'The WhatsApp signup session was not found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'code_received' or cardinality(v_session.messaging_account_ids) = 0 then
    raise exception 'The WhatsApp signup session is not waiting for a token' using errcode = '55000';
  end if;
  if p_access_token is null or length(p_access_token) not between 20 and 4096 or p_access_token ~ '\s' then
    raise exception 'The business token is not a valid token' using errcode = '22023';
  end if;

  v_prefix := 'whatsapp_access_token:' || v_session.company_id::text || ':onboarding:';
  v_secret := vault.create_secret(p_access_token, v_prefix || v_session.id::text,
    'WhatsApp business token from Embedded Signup');
  v_reference := 'secret://vault/' || v_secret::text;

  if v_session.phone_number_id is not null then
    -- Meta reports one number and the shared accounts; the number is recorded under the first account.
    -- Verification later confirms it with Meta; until then it is only pending.
    insert into public.whatsapp_phone_numbers as n
      (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference,
       connection_status, webhook_configured)
    values (v_session.company_id, v_session.messaging_account_ids[1], v_session.phone_number_id, '', '', v_reference,
            'pending_verification', false)
    on conflict (company_id, phone_number_id) do update
    set business_account_id = excluded.business_account_id,
        access_token_reference = excluded.access_token_reference,
        connection_status = 'pending_verification',
        webhook_configured = false,
        last_verified_at = null,
        verified_name = null,
        quality_rating = null,
        code_verification_status = null,
        name_status = null,
        meta_status = null;
  end if;

  -- The shared accounts are recorded after the number: moving an existing number to the first shared account
  -- fires remove_emptied_business_account (20261110100500), which runs here too because the caller's role is
  -- still 'authenticated', and deletes the number's previous account when nothing else uses it. Upserting the
  -- shared accounts last keeps every account Meta shared, with this token, even if that trigger just removed it.
  insert into public.whatsapp_business_accounts (company_id, business_account_id, access_token_reference)
  select v_session.company_id, account_id, v_reference
  from unnest(v_session.messaging_account_ids) as account_id
  on conflict (company_id, business_account_id) do update set access_token_reference = excluded.access_token_reference;

  -- Earlier Embedded Signup tokens of this company that no account or number uses any more.
  delete from vault.secrets s
  where starts_with(s.name, v_prefix)
    and s.id <> v_secret
    and not exists (select 1 from public.whatsapp_business_accounts a
                    where a.company_id = v_session.company_id and a.access_token_reference = 'secret://vault/' || s.id::text)
    and not exists (select 1 from public.whatsapp_phone_numbers n
                    where n.company_id = v_session.company_id and n.access_token_reference = 'secret://vault/' || s.id::text);

  update public.whatsapp_onboarding_sessions
  set status = 'exchanged', finished_at = now(), error_message = null
  where id = v_session.id;

  return query
    select account_id, case when ordinality = 1 then v_session.phone_number_id end
    from unnest(v_session.messaging_account_ids) with ordinality as t (account_id, ordinality);
end;
$$;
revoke all on function public.store_whatsapp_onboarding_token(uuid, uuid, text) from public, anon;
grant execute on function public.store_whatsapp_onboarding_token(uuid, uuid, text) to authenticated;
comment on function public.store_whatsapp_onboarding_token(uuid, uuid, text) is
  'Company admin who started the session, after the API exchanged its code: stores the business token in Vault for that company and records the shared accounts and number as pending verification.';
