-- Meta-side disconnects, number quality and template status changes (ticket 06).
--
-- Delivery statuses of outbound messages already have their transition (record_communication_provider_status,
-- 20261110100300): monotonic and safe out of order. This migration adds what Meta's account-level webhooks need.
-- Those events (account_update, message_template_status_update, phone_number_quality_update) carry no receiving
-- number, only the WhatsApp Business Account (entry.id). They therefore apply to the companies that HOLD VERIFIED
-- ACCESS to that account: a business token stored for it by Embedded Signup, or a number of it LeaseGuard verified
-- and connected. A company that merely typed the same account id (PUT /companies/:id/whatsapp, never verified) is
-- not a holder and is never touched by another business's events.
--
-- * whatsapp_business_account_holders (service role): that rule, in one place.
-- * remove_whatsapp_business_account_access (service role, SECURITY DEFINER for Vault): Meta reports that the business
--   removed LeaseGuard (PARTNER_APP_UNINSTALLED, PARTNER_REMOVED) or the account is gone (ACCOUNT_DELETED,
--   ACCOUNT_OFFBOARDED). Each holder's numbers in the account are disconnected with the reason, the stored token is
--   deleted, and the company's active admins are notified. A token stored after the event (or a number verified after
--   it) is a newer grant and is left alone, so a late event never undoes a reconnect.
-- * apply_whatsapp_template_status (service role): one template's new Meta status, applied only when it is newer than
--   what LeaseGuard holds (the last sync or the last event), and reflected onto the company's own templates like the
--   sync does.
-- * whatsapp_phone_numbers: why and when a number was disconnected (cleared when it is connected again) and Meta's
--   messaging limit; whatsapp_message_templates: when Meta last changed the status.

-- ------------------------------------------------------------------ columns
alter table public.whatsapp_phone_numbers
  add column disconnected_at timestamptz,
  add column disconnected_reason text check (disconnected_reason is null or length(disconnected_reason) <= 500),
  add column messaging_limit_tier text check (messaging_limit_tier is null or length(messaging_limit_tier) <= 40),
  add column messaging_limit_updated_at timestamptz;
comment on column public.whatsapp_phone_numbers.disconnected_at is 'When the number was last disconnected; null while it is not disconnected.';
comment on column public.whatsapp_phone_numbers.disconnected_reason is
  'Why the number was disconnected, written for the company admin, when Meta reported it (service role only); null for a disconnect in LeaseGuard.';
comment on column public.whatsapp_phone_numbers.messaging_limit_tier is 'Meta''s messaging limit, e.g. TIER_1K, from phone_number_quality_update (service role only).';
comment on column public.whatsapp_phone_numbers.messaging_limit_updated_at is 'When Meta reported the messaging limit (the webhook entry time).';
grant select (disconnected_at, disconnected_reason, messaging_limit_tier, messaging_limit_updated_at)
  on public.whatsapp_phone_numbers to authenticated;

alter table public.whatsapp_message_templates add column status_updated_at timestamptz;
comment on column public.whatsapp_message_templates.status_updated_at is
  'When Meta changed the status, from message_template_status_update; a status older than this or than synced_at is ignored.';

-- ------------------------------------------------------------------ disconnection time and reason
create function private.track_whatsapp_disconnection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.connection_status = 'disconnected' then
    if tg_op = 'INSERT' or old.connection_status is distinct from 'disconnected' then
      new.disconnected_at := coalesce(new.disconnected_at, now());
    end if;
  else
    new.disconnected_at := null;
    new.disconnected_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_whatsapp_disconnection() from public;
create trigger track_disconnection before insert or update of connection_status, disconnected_at, disconnected_reason
  on public.whatsapp_phone_numbers
  for each row execute function private.track_whatsapp_disconnection();

-- ------------------------------------------------------------------ who holds an account
create function public.whatsapp_business_account_holders(p_business_account_id text)
returns table (company_id uuid)
language sql
stable
set search_path = ''
as $$
  select a.company_id
  from public.whatsapp_business_accounts a
  where a.business_account_id = p_business_account_id
    and (a.access_token_reference is not null
         or exists (select 1 from public.whatsapp_phone_numbers n
                    where n.company_id = a.company_id and n.business_account_id = a.business_account_id
                      and n.connection_status = 'connected'))
  order by a.company_id
$$;
revoke all on function public.whatsapp_business_account_holders(text) from public, anon, authenticated;
grant execute on function public.whatsapp_business_account_holders(text) to service_role;
comment on function public.whatsapp_business_account_holders(text) is
  'Service role (worker): the companies with verified access to a WhatsApp Business Account (a stored business token or a connected number). Account-level Meta events apply to these only.';

-- ------------------------------------------------------------------ Meta-side removal
-- p_occurred_at is the webhook entry time; Meta may omit it, so it defaults to null (now) and can be left out.
create function public.remove_whatsapp_business_account_access(p_business_account_id text, p_event text, p_occurred_at timestamptz default null)
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
               || ' until a company admin connects again with Connect WhatsApp Business on the WhatsApp integration page.',
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

-- Whether a token reference is a vault secret stored after p_at (a grant newer than the event).
create function private.whatsapp_token_granted_after(p_reference text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(starts_with(p_reference, 'secret://vault/')
    and exists (select 1 from vault.secrets s where 'secret://vault/' || s.id::text = p_reference and s.created_at > p_at), false)
$$;
revoke all on function private.whatsapp_token_granted_after(text, timestamptz) from public, anon, authenticated;

revoke all on function public.remove_whatsapp_business_account_access(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.remove_whatsapp_business_account_access(text, text, timestamptz) to service_role;
comment on function public.remove_whatsapp_business_account_access(text, text, timestamptz) is
  'Service role (worker): Meta reports LeaseGuard removed from a WhatsApp Business Account. Disconnects each holder''s numbers in it, deletes the stored token and notifies the company admins. Grants newer than the event are kept.';

-- ------------------------------------------------------------------ template status changes
-- How LeaseGuard treats Meta's template status when sending: a flagged template is still sent by Meta. The one
-- mapping for both paths: apply_whatsapp_template_status below and sync_whatsapp_message_templates (redefined
-- below to use it), so a webhook and the next sync never disagree about the same Meta status.
create function private.whatsapp_template_approval(p_status text)
returns public.template_approval_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status in ('APPROVED', 'FLAGGED') then 'approved'
    when p_status in ('PENDING', 'IN_APPEAL') then 'submitted'
    else 'rejected'
  end::public.template_approval_status
$$;
revoke all on function private.whatsapp_template_approval(text) from public;
grant execute on function private.whatsapp_template_approval(text) to service_role;

-- Outcomes per holder: added | updated | removed (DELETED) | stale (older than what LeaseGuard holds) |
-- unknown_template (not synced and the event names no template LeaseGuard could record).
create function public.apply_whatsapp_template_status(
  p_business_account_id text,
  p_meta_template_id text,
  p_name text,
  p_language text,
  p_category text,
  p_status text,
  p_reason text,
  p_occurred_at timestamptz default null  -- the webhook entry time; Meta may omit it (then now)
)
returns table (company_id uuid, outcome text)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_status text := upper(btrim(p_status));
  -- Meta's reason keeps its own casing for display; NONE means no reason.
  v_reason text := case when p_reason is null or upper(btrim(p_reason)) in ('', 'NONE') then null else left(btrim(p_reason), 200) end;
  v_company uuid;
  v_row public.whatsapp_message_templates;
  v_name text;
  v_language text;
  v_outcome text;
begin
  if p_meta_template_id is null or p_meta_template_id !~ '^[0-9]{1,32}$' then
    raise exception 'A Meta template id is digits' using errcode = '22023';
  end if;
  -- Only Meta's template statuses: an event that names no status (UNARCHIVED, LOCKED, ...) must never be stored
  -- as one, because anything unknown maps to rejected. The worker records those as not_handled.
  if v_status is null or v_status not in ('APPROVED', 'REJECTED', 'PENDING', 'PAUSED', 'DISABLED', 'FLAGGED',
                                          'IN_APPEAL', 'LIMIT_EXCEEDED', 'ARCHIVED', 'DELETED', 'PENDING_DELETION') then
    raise exception 'Not a Meta template status: %', left(coalesce(p_status, 'null'), 40) using errcode = '22023';
  end if;

  for v_company in select h.company_id from public.whatsapp_business_account_holders(p_business_account_id) h loop
    select * into v_row from public.whatsapp_message_templates w
    where w.company_id = v_company and w.business_account_id = p_business_account_id and w.meta_template_id = p_meta_template_id
    for update;

    if found and v_at <= greatest(v_row.synced_at, coalesce(v_row.status_updated_at, '-infinity'::timestamptz)) then
      v_outcome := 'stale';
    elsif found and v_status = 'DELETED' then
      delete from public.whatsapp_message_templates w where w.id = v_row.id;
      v_outcome := 'removed';
    elsif found then
      update public.whatsapp_message_templates w
      set status = v_status, rejected_reason = v_reason, status_updated_at = v_at,
          category = coalesce(nullif(upper(btrim(p_category)), ''), w.category)
      where w.id = v_row.id;
      v_outcome := 'updated';
    elsif v_status <> 'DELETED' and nullif(btrim(p_name), '') is not null and nullif(btrim(p_language), '') is not null then
      insert into public.whatsapp_message_templates
        (company_id, business_account_id, meta_template_id, name, language, category, status, rejected_reason, synced_at, status_updated_at)
      values (v_company, p_business_account_id, p_meta_template_id, left(btrim(p_name), 512), left(btrim(p_language), 20),
              left(coalesce(nullif(upper(btrim(p_category)), ''), 'UNKNOWN'), 40), v_status, v_reason, v_at, v_at);
      v_outcome := 'added';
    else
      v_outcome := 'unknown_template';
    end if;

    if v_outcome in ('added', 'updated', 'removed') then
      v_name := coalesce(v_row.name, btrim(p_name));
      v_language := coalesce(v_row.language, btrim(p_language));
      if v_outcome = 'removed' then
        -- Meta no longer holds it: unless another account of the company does, the company's template is no longer sendable.
        update public.message_templates m
        set approval_status = 'draft'
        where m.company_id = v_company and m.meta_template_name = v_name and m.language = v_language
          and m.approval_status in ('approved', 'submitted')
          and not exists (select 1 from public.whatsapp_message_templates w
                          where w.company_id = v_company and w.name = v_name and w.language = v_language);
      else
        update public.message_templates m
        set approval_status = private.whatsapp_template_approval(v_status)
        where m.company_id = v_company and m.meta_template_name = v_name and m.language = v_language
          and m.approval_status is distinct from private.whatsapp_template_approval(v_status);
      end if;
    end if;

    company_id := v_company;
    outcome := v_outcome;
    return next;
    v_row := null;
  end loop;
end;
$$;
revoke all on function public.apply_whatsapp_template_status(text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_whatsapp_template_status(text, text, text, text, text, text, text, timestamptz) to service_role;
comment on function public.apply_whatsapp_template_status(text, text, text, text, text, text, text, timestamptz) is
  'Service role (worker): applies Meta''s message_template_status_update to each holder of the account, in order, and reflects it onto the company''s own templates.';

-- ------------------------------------------------------------------ template sync uses the same mapping
-- sync_whatsapp_message_templates (20261110100700) mapped only APPROVED to approved, so a FLAGGED template the webhook
-- marked approved went to rejected on the next sync although Meta's status had not changed. Same function, same
-- grants, the shared mapping private.whatsapp_template_approval.
create or replace function public.sync_whatsapp_message_templates(p_company_id uuid, p_business_account_id text, p_templates jsonb)
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
  set approval_status = private.whatsapp_template_approval(t.status)
  from pg_temp.synced_templates t
  where m.company_id = p_company_id and m.meta_template_name = t.name and m.language = t.language
    and m.approval_status is distinct from private.whatsapp_template_approval(t.status);

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
comment on function public.sync_whatsapp_message_templates(uuid, text, jsonb) is
  'Service role (worker): replaces an account''s synced Meta templates and reflects their status onto the company''s message_templates (private.whatsapp_template_approval: APPROVED and FLAGGED approved, PENDING and IN_APPEAL submitted, else rejected).';
