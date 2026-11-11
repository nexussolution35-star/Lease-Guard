-- Number import (ticket 15): a Nexus operator connects Nexus Solution's own WhatsApp test number to one named company
-- before Meta approves LeaseGuard's app, so the team can receive and send real WhatsApp messages without Embedded
-- Signup (before App Review only the app's own test numbers and app-role users can complete it).
--
-- The operator command (pnpm whatsapp:import-test-number, backend/src/operator/) reads the installation's test-number
-- settings (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID) and calls
-- import_whatsapp_number with the service role:
--   * dry run (p_apply = false, the default): says what it would do, writes nothing;
--   * apply: stores the token in Vault for that company only (named whatsapp_access_token:<company id>:import:<uuid>, so
--     whatsapp_account_access_token resolves it for that company's numbers only), records the WhatsApp Business Account
--     and the number pending verification with that credential, stamps the number operator_imported_at, and deletes the
--     earlier token it replaced when nothing else of the company uses it. The command then queues the same number
--     verification Embedded Signup uses (20261110100700): the number is connected only after LeaseGuard verified it.
-- It refuses an unknown or inactive company, a number another company has connected or holds with a token Meta granted
-- (its own signup waiting for verification), and a number of a WhatsApp Business Account another company holds (the
-- account holder rule of 20261110101000). A number another company merely typed (never verified, no token) does not
-- belong to it, like everywhere else (ADR 0002). Re-running is safe: accounts and numbers are upserted, the same token is
-- kept (a connected number with the same token and account is left alone), and a newer token replaces the stored one
-- as a new secret (a newer grant, so a late Meta removal event never undoes it).
--
-- store_whatsapp_onboarding_token (20261110100600) is redefined: a WhatsApp signup of an imported number clears its
-- import stamp and deletes the import's token once nothing uses it, so moving from the import to Embedded Signup after
-- Meta's approval leaves no stray secret. Its behaviour is otherwise unchanged.
--
-- remove_whatsapp_business_account_access (20261110101000) is redefined: when Meta removes LeaseGuard's access to the
-- account of an imported number, the admins' notification says to ask Nexus Solution to import it again (number
-- import) instead of using Connect WhatsApp Business, which stays the way back for numbers that were not imported. Its
-- behaviour is otherwise unchanged.

-- ------------------------------------------------------------------ import stamp
alter table public.whatsapp_phone_numbers add column operator_imported_at timestamptz;
comment on column public.whatsapp_phone_numbers.operator_imported_at is
  'When a Nexus operator last connected this number with the number import (pnpm whatsapp:import-test-number); null for a number from WhatsApp signup or added by an admin. Kept when the number is disconnected (it is imported again, not signed up); cleared by a WhatsApp signup of the number. Service role only.';
grant select (operator_imported_at) on public.whatsapp_phone_numbers to authenticated;

-- ------------------------------------------------------------------ the import
create function public.import_whatsapp_number(
  p_company_id uuid,
  p_business_account_id text,
  p_phone_number_id text,
  p_access_token text,
  p_apply boolean default false
)
returns table (
  -- company_not_found | company_not_active | number_in_use | account_in_use (refused, nothing written);
  -- new_number | token_stored | token_unchanged (the number is, or would be, pending verification);
  -- already_connected (connected with this token and account: nothing to do).
  outcome text,
  applied boolean,
  company_name text,
  -- The company's number with this phone number id (null for a new number in a dry run, and for refusals).
  number_id uuid,
  previous_status public.whatsapp_connection_status,
  -- For number_in_use and account_in_use: the company that holds it (the operator resolves it there).
  conflicting_company_id uuid,
  conflicting_company_name text,
  -- Earlier tokens of the company this import deleted from Vault.
  secrets_deleted integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_company public.companies;
  v_conflict record;
  v_number public.whatsapp_phone_numbers;
  v_company_prefix text := 'whatsapp_access_token:' || p_company_id::text || ':';
  v_same_token boolean := false;
  v_outcome text;
  v_reference text;
  v_old_refs text[];
  v_number_id uuid;
  v_deleted integer := 0;
begin
  if p_business_account_id is null or p_business_account_id !~ '^[0-9]{1,32}$' then
    raise exception 'The WhatsApp Business Account id must be Meta''s numeric id' using errcode = '22023';
  end if;
  if p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,32}$' then
    raise exception 'The phone number id must be Meta''s numeric id' using errcode = '22023';
  end if;
  -- Never echo the token: the message names the rule only.
  if p_access_token is null or length(p_access_token) not between 20 and 4096 or p_access_token ~ '\s' then
    raise exception 'The access token is not a valid token (20 to 4096 characters, no whitespace)' using errcode = '22023';
  end if;

  select * into v_company from public.companies c where c.id = p_company_id;
  if not found then
    return query select 'company_not_found'::text, false, null::text, null::uuid, null::public.whatsapp_connection_status, null::uuid, null::text, 0;
    return;
  end if;
  if v_company.status <> 'active' then
    return query select 'company_not_active'::text, false, v_company.name, null::uuid, null::public.whatsapp_connection_status, null::uuid, null::text, 0;
    return;
  end if;

  -- Two imports of the same number never interleave.
  perform pg_advisory_xact_lock(hashtextextended('whatsapp_number_import:' || p_phone_number_id, 0));

  -- The number belongs to another company: connected there, or held there with a token Meta granted.
  select n.company_id, c.name into v_conflict
  from public.whatsapp_phone_numbers n
  join public.companies c on c.id = n.company_id
  where n.phone_number_id = p_phone_number_id and n.company_id <> p_company_id
    and (n.connection_status = 'connected'
         or (n.connection_status <> 'disconnected' and starts_with(n.access_token_reference, 'secret://vault/')))
  order by n.connection_status = 'connected' desc, n.created_at
  limit 1;
  if found then
    return query select 'number_in_use'::text, false, v_company.name, null::uuid, null::public.whatsapp_connection_status,
                        v_conflict.company_id, v_conflict.name, 0;
    return;
  end if;
  -- Its WhatsApp Business Account belongs to another company (an account holder: a stored token or a connected number).
  select h.company_id, c.name into v_conflict
  from public.whatsapp_business_account_holders(p_business_account_id) h
  join public.companies c on c.id = h.company_id
  where h.company_id <> p_company_id
  limit 1;
  if found then
    return query select 'account_in_use'::text, false, v_company.name, null::uuid, null::public.whatsapp_connection_status,
                        v_conflict.company_id, v_conflict.name, 0;
    return;
  end if;

  select * into v_number from public.whatsapp_phone_numbers n
  where n.company_id = p_company_id and n.phone_number_id = p_phone_number_id
  for update;
  if v_number.id is not null and starts_with(v_number.access_token_reference, 'secret://vault/') then
    v_same_token := exists (
      select 1 from vault.decrypted_secrets s
      where 'secret://vault/' || s.id::text = v_number.access_token_reference
        and (s.name = 'whatsapp_access_token:' || p_company_id::text or starts_with(s.name, v_company_prefix))
        and s.decrypted_secret = p_access_token);
  end if;
  v_outcome := case
    when v_number.id is null then 'new_number'
    when v_same_token and v_number.business_account_id = p_business_account_id and v_number.connection_status = 'connected' then 'already_connected'
    when v_same_token then 'token_unchanged'
    else 'token_stored'
  end;

  if not p_apply or v_outcome = 'already_connected' then
    return query select v_outcome, p_apply, v_company.name, v_number.id, v_number.connection_status, null::uuid, null::text, 0;
    return;
  end if;

  -- The references this import may replace: the number's and those of the accounts it leaves or joins.
  select array_agg(distinct r) filter (where starts_with(r, 'secret://vault/')) into v_old_refs
  from (
    select v_number.access_token_reference as r
    union all
    select a.access_token_reference from public.whatsapp_business_accounts a
    where a.company_id = p_company_id and a.business_account_id in (p_business_account_id, v_number.business_account_id)
  ) refs;

  if v_same_token then
    v_reference := v_number.access_token_reference;
  else
    v_reference := 'secret://vault/' || vault.create_secret(
      p_access_token, v_company_prefix || 'import:' || gen_random_uuid()::text,
      'WhatsApp access token imported by a Nexus operator (number import)')::text;
  end if;

  insert into public.whatsapp_phone_numbers as n
    (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference,
     connection_status, webhook_configured, operator_imported_at)
  values (p_company_id, p_business_account_id, p_phone_number_id, '', '', v_reference, 'pending_verification', false, now())
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
      meta_status = null,
      operator_imported_at = excluded.operator_imported_at
  returning n.id into v_number_id;

  insert into public.whatsapp_business_accounts (company_id, business_account_id, access_token_reference)
  values (p_company_id, p_business_account_id, v_reference)
  on conflict (company_id, business_account_id) do update set access_token_reference = excluded.access_token_reference;

  -- A corrected account id: the account the number left is removed when no number of the company is in it any more
  -- and it holds no other token (the remove_emptied_business_account trigger only cleans up admins' edits).
  if v_number.id is not null and v_number.business_account_id <> p_business_account_id then
    delete from public.whatsapp_business_accounts a
    where a.company_id = p_company_id and a.business_account_id = v_number.business_account_id
      and (a.access_token_reference is null or a.access_token_reference = any (coalesce(v_old_refs, '{}')))
      and not exists (select 1 from public.whatsapp_phone_numbers n
                      where n.company_id = p_company_id and n.business_account_id = a.business_account_id);
  end if;

  -- The tokens this import replaced, and earlier imported tokens of the company nothing references any more.
  delete from vault.secrets s
  where (s.name = 'whatsapp_access_token:' || p_company_id::text or starts_with(s.name, v_company_prefix))
    and ('secret://vault/' || s.id::text = any (coalesce(v_old_refs, '{}')) or starts_with(s.name, v_company_prefix || 'import:'))
    and 'secret://vault/' || s.id::text <> v_reference
    and not exists (select 1 from public.whatsapp_business_accounts a
                    where a.company_id = p_company_id and a.access_token_reference = 'secret://vault/' || s.id::text)
    and not exists (select 1 from public.whatsapp_phone_numbers n
                    where n.company_id = p_company_id and n.access_token_reference = 'secret://vault/' || s.id::text);
  get diagnostics v_deleted = row_count;

  return query select v_outcome, true, v_company.name, v_number_id, v_number.connection_status, null::uuid, null::text, v_deleted;
end;
$$;
revoke all on function public.import_whatsapp_number(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.import_whatsapp_number(uuid, text, text, text, boolean) to service_role;
comment on function public.import_whatsapp_number(uuid, text, text, text, boolean) is
  'Service role (operator command whatsapp:import-test-number): plans or applies the number import of one WhatsApp number into one company. The token goes to Vault for that company only; the number stays pending verification until the worker verified it. Never returns the token.';

-- ------------------------------------------------------------------ a later WhatsApp signup of an imported number
-- Same as 20261110100600, plus: the number's import stamp is cleared, and earlier imported tokens of the company that
-- nothing references any more are deleted with the earlier Embedded Signup tokens.
create or replace function public.store_whatsapp_onboarding_token(p_company_id uuid, p_session_id uuid, p_access_token text)
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
  v_import_prefix text;
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
  v_import_prefix := 'whatsapp_access_token:' || v_session.company_id::text || ':import:';
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
        meta_status = null,
        operator_imported_at = null;
  end if;

  -- The shared accounts are recorded after the number: moving an existing number to the first shared account
  -- fires remove_emptied_business_account (20261110100500), which runs here too because the caller's role is
  -- still 'authenticated', and deletes the number's previous account when nothing else uses it. Upserting the
  -- shared accounts last keeps every account Meta shared, with this token, even if that trigger just removed it.
  insert into public.whatsapp_business_accounts (company_id, business_account_id, access_token_reference)
  select v_session.company_id, account_id, v_reference
  from unnest(v_session.messaging_account_ids) as account_id
  on conflict (company_id, business_account_id) do update set access_token_reference = excluded.access_token_reference;

  -- Earlier Embedded Signup and imported tokens of this company that no account or number uses any more.
  delete from vault.secrets s
  where (starts_with(s.name, v_prefix) or starts_with(s.name, v_import_prefix))
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

-- ------------------------------------------------------------------ Meta removes access to an imported number
-- Same as 20261110101000, except the admins' notification says how each disconnected number is connected again. The
-- import's token makes the company the account holder, so Meta's removal events (PARTNER_APP_UNINSTALLED,
-- PARTNER_REMOVED, ACCOUNT_DELETED, ACCOUNT_OFFBOARDED) disconnect an imported number too; like the integration page
-- and the verification steps, the notification then says to ask Nexus Solution to import it again, and keeps Connect
-- WhatsApp Business for the numbers that were not imported.
create or replace function public.remove_whatsapp_business_account_access(p_business_account_id text, p_event text, p_occurred_at timestamptz default null)
returns table (company_id uuid, numbers_disconnected integer, token_removed boolean, admins_notified integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_reason text;
  v_company uuid;
  v_refs text[];
  v_numbers integer;
  v_imported integer;
  v_recovery text;
  v_removed integer;
  v_notified integer;
begin
  v_reason := case p_event
    when 'PARTNER_APP_UNINSTALLED' then 'The business removed LeaseGuard from this WhatsApp Business Account in Meta.'
    when 'PARTNER_REMOVED' then 'LeaseGuard was removed as a partner of this WhatsApp Business Account in Meta.'
    when 'ACCOUNT_DELETED' then 'Meta reported that this WhatsApp Business Account was deleted.'
    when 'ACCOUNT_OFFBOARDED' then 'Meta reported that this WhatsApp Business Account was offboarded.'
  end;
  if v_reason is null then
    raise exception 'Only an event that ends LeaseGuard''s access disconnects an account' using errcode = '22023';
  end if;

  for v_company in select h.company_id from public.whatsapp_business_account_holders(p_business_account_id) h loop
    -- References granted before the event: the account's and its numbers' (a vault token newer than the event is a
    -- later grant; the env form is the worker's own variable and is revoked by disconnecting the numbers).
    create temporary table if not exists pg_temp.revoked_numbers (id uuid, reference text) on commit drop;
    truncate pg_temp.revoked_numbers;

    insert into pg_temp.revoked_numbers (id, reference)
    select n.id, n.access_token_reference
    from public.whatsapp_phone_numbers n
    where n.company_id = v_company and n.business_account_id = p_business_account_id
      and n.connection_status <> 'disconnected'
      and (n.last_verified_at is null or n.last_verified_at <= v_at)
      and not private.whatsapp_token_granted_after(n.access_token_reference, v_at);

    update public.whatsapp_phone_numbers n
    set connection_status = 'disconnected', webhook_configured = false, last_verified_at = null,
        access_token_reference = null,  -- prepare_whatsapp_account turns it into the company's env form
        disconnected_reason = v_reason
    where n.id in (select r.id from pg_temp.revoked_numbers r);
    get diagnostics v_numbers = row_count;
    delete from public.whatsapp_number_verification_steps s
    where s.company_id = v_company and s.number_id in (select r.id from pg_temp.revoked_numbers r);

    -- The disconnected numbers a Nexus operator connected with the number import (the stamp survives the disconnect).
    select count(*)::integer into v_imported
    from public.whatsapp_phone_numbers n
    where n.id in (select r.id from pg_temp.revoked_numbers r) and n.operator_imported_at is not null;

    select array_agg(distinct x.reference) into v_refs
    from (
      select r.reference from pg_temp.revoked_numbers r
      union all
      select a.access_token_reference from public.whatsapp_business_accounts a
      where a.company_id = v_company and a.business_account_id = p_business_account_id
        and a.access_token_reference is not null
        and not private.whatsapp_token_granted_after(a.access_token_reference, v_at)
    ) x
    where starts_with(x.reference, 'secret://vault/');

    update public.whatsapp_business_accounts a
    set access_token_reference = null
    where a.company_id = v_company and a.business_account_id = p_business_account_id
      and a.access_token_reference = any (coalesce(v_refs, '{}'));

    -- A token is deleted once nothing of the company references it any more (another account or a number still
    -- in use keeps it, as disconnect_whatsapp_number does).
    delete from vault.secrets s
    where 'secret://vault/' || s.id::text = any (coalesce(v_refs, '{}'))
      and (s.name = 'whatsapp_access_token:' || v_company::text or starts_with(s.name, 'whatsapp_access_token:' || v_company::text || ':'))
      and not exists (select 1 from public.whatsapp_business_accounts a
                      where a.company_id = v_company and a.access_token_reference = 'secret://vault/' || s.id::text)
      and not exists (select 1 from public.whatsapp_phone_numbers n
                      where n.company_id = v_company and n.access_token_reference = 'secret://vault/' || s.id::text);
    get diagnostics v_removed = row_count;

    -- How the numbers are connected again: an imported number by Nexus Solution with the number import, any other
    -- by a company admin with Connect WhatsApp Business.
    v_recovery := case
      when v_imported = 0 then
        ' until a company admin connects again with Connect WhatsApp Business on the WhatsApp integration page.'
      when v_imported = v_numbers then
        ' until ' || case when v_numbers = 1 then 'it is' else 'they are' end
          || ' imported again: ask Nexus Solution to import ' || case when v_numbers = 1 then 'it' else 'them' end
          || ' again with the number import.'
      else
        ' until they are connected again. Ask Nexus Solution to import '
          || case when v_imported = 1 then 'the imported number' else 'the ' || v_imported || ' imported numbers' end
          || ' again with the number import; a company admin connects '
          || case when v_numbers - v_imported = 1 then 'the other number' else 'the other ' || (v_numbers - v_imported) || ' numbers' end
          || ' again with Connect WhatsApp Business on the WhatsApp integration page.'
    end;

    v_notified := 0;
    if v_numbers > 0 or v_removed > 0 then
      insert into public.notifications (company_id, user_id, type, severity, title, body, dedupe_key)
      select v_company, cu.user_id, 'system', 'critical', 'WhatsApp disconnected in Meta',
             -- Only what happened: the stored token is mentioned only when it was deleted (a number on the worker's
             -- own env token, or a token another account still uses, has none deleted).
             v_reason || ' LeaseGuard disconnected ' || v_numbers || case when v_numbers = 1 then ' number' else ' numbers' end
               || ' of WhatsApp Business Account ' || left(p_business_account_id, 64)
               || case when v_removed > 0 then ' and deleted its stored access token' else '' end
               || '. WhatsApp messages cannot be sent or received on '
               || case when v_numbers = 1 then 'it' else 'them' end
               || v_recovery,
             'whatsapp-access-removed:' || md5(p_business_account_id) || ':' || floor(extract(epoch from v_at))::bigint || ':' || cu.user_id::text
      from public.company_users cu
      join public.profiles p on p.id = cu.user_id
      where cu.company_id = v_company and cu.role = 'company_admin' and p.status = 'active'
      on conflict (company_id, dedupe_key) do nothing;
      get diagnostics v_notified = row_count;
    end if;

    company_id := v_company;
    numbers_disconnected := v_numbers;
    token_removed := v_removed > 0;
    admins_notified := v_notified;
    return next;
  end loop;
end;
$$;
revoke all on function public.remove_whatsapp_business_account_access(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.remove_whatsapp_business_account_access(text, text, timestamptz) to service_role;
comment on function public.remove_whatsapp_business_account_access(text, text, timestamptz) is
  'Service role (worker): Meta reports LeaseGuard removed from a WhatsApp Business Account. Disconnects each holder''s numbers in it, deletes the stored token and notifies the company admins (an imported number: ask Nexus Solution to import it again; any other: Connect WhatsApp Business). Grants newer than the event are kept.';
