-- Several WhatsApp Business Accounts and business numbers per company.
--
-- Until now a company had exactly one row in whatsapp_accounts (company_id was unique), which mixed
-- two Meta objects: the WhatsApp Business Account (WABA, Meta's container of numbers and templates)
-- and one of its phone numbers. Embedded Signup can bring several accounts and several numbers per
-- company, so:
--
-- * whatsapp_accounts is renamed whatsapp_phone_numbers: one row per business number, as before
--   (phone_number_id, display fields, connection status, credential reference). A company may now hold
--   several; the same phone_number_id only once per company.
-- * whatsapp_business_accounts (new): one row per WABA of a company, keyed by (company_id,
--   business_account_id). A number references its account by that pair, so a number can only belong
--   to an account of its own company (composite foreign key).
-- * Signed-in users never write accounts directly: adding a number (company_admin, column grants of
--   20261109102100) records its account through a SECURITY DEFINER trigger; the service role (Embedded
--   Signup, verification) writes both tables. If the number's own insert is then refused by Row Level
--   Security, the whole statement rolls back, so a refused number never leaves an account behind.
-- * Each receiving number still belongs to one company only: at most one connected row per
--   phone_number_id across all companies (20261110100100, index renamed below).
-- * Meta's view of a number (verified name, quality rating, code verification, display-name status,
--   Meta's own status) is recorded by the service role only; changing a number's Meta ids drops it,
--   like the verified connection.
-- * The credential reference is no longer readable by signed-in users (column grants): members see
--   every other column, the worker reads the reference with the service role.

-- ------------------------------------------------------------------ numbers (renamed)
alter table public.whatsapp_accounts rename to whatsapp_phone_numbers;
alter index public.whatsapp_accounts_connected_phone_number_id_key rename to whatsapp_phone_numbers_connected_phone_number_id_key;
alter table public.whatsapp_phone_numbers drop constraint whatsapp_accounts_company_id_key;
alter table public.whatsapp_phone_numbers
  add constraint whatsapp_phone_numbers_company_phone_number_key unique (company_id, phone_number_id);

alter table public.whatsapp_phone_numbers
  add column verified_name text check (verified_name is null or length(verified_name) <= 200),
  add column quality_rating text check (quality_rating is null or length(quality_rating) <= 40),
  add column code_verification_status text check (code_verification_status is null or length(code_verification_status) <= 40),
  add column name_status text check (name_status is null or length(name_status) <= 60),
  add column meta_status text check (meta_status is null or length(meta_status) <= 40);

comment on table public.whatsapp_phone_numbers is
  'A company''s WhatsApp business numbers (several per company). A connected number is a receiving number of exactly one company.';
comment on column public.whatsapp_phone_numbers.verified_name is 'Meta''s verified display name of the number (service role only).';
comment on column public.whatsapp_phone_numbers.quality_rating is 'Meta''s quality rating, e.g. GREEN (service role only).';
comment on column public.whatsapp_phone_numbers.code_verification_status is 'Meta''s code_verification_status, e.g. VERIFIED (service role only).';
comment on column public.whatsapp_phone_numbers.name_status is 'Meta''s display-name review status, e.g. APPROVED (service role only).';
comment on column public.whatsapp_phone_numbers.meta_status is 'Meta''s own status of the number, e.g. CONNECTED (service role only).';

-- ------------------------------------------------------------------ business accounts
create table public.whatsapp_business_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  business_account_id text not null check (length(business_account_id) between 1 and 64),
  name text check (name is null or length(name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_business_accounts_company_account_key unique (company_id, business_account_id)
);
comment on table public.whatsapp_business_accounts is
  'A company''s WhatsApp Business Accounts (Meta WABA ids). Written by the service role and by the trigger that records the account of a number an admin adds.';

create trigger set_updated_at before update on public.whatsapp_business_accounts
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_business_accounts
  for each row execute function private.prevent_company_change();

-- Existing numbers keep working: each gets its company's account.
insert into public.whatsapp_business_accounts (company_id, business_account_id)
select distinct company_id, business_account_id from public.whatsapp_phone_numbers
on conflict do nothing;

alter table public.whatsapp_phone_numbers
  add constraint whatsapp_phone_numbers_business_account_fkey
  foreign key (company_id, business_account_id)
  references public.whatsapp_business_accounts (company_id, business_account_id);
create index whatsapp_phone_numbers_business_account_idx
  on public.whatsapp_phone_numbers (company_id, business_account_id);

alter table public.whatsapp_business_accounts enable row level security;
grant select on public.whatsapp_business_accounts to authenticated;
grant select, insert, update, delete on public.whatsapp_business_accounts to service_role;
create policy members_read on public.whatsapp_business_accounts for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- The account of a number, recorded when the number is written. SECURITY DEFINER because signed-in
-- users have no write privilege on whatsapp_business_accounts; it only ever creates the pair the
-- number row itself names, and the number's own Row Level Security check rolls it back when the
-- caller may not write that number.
create function private.record_whatsapp_business_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.whatsapp_business_accounts (company_id, business_account_id)
  values (new.company_id, new.business_account_id)
  on conflict (company_id, business_account_id) do nothing;
  return new;
end;
$$;
revoke all on function private.record_whatsapp_business_account() from public;

create trigger record_business_account before insert or update of company_id, business_account_id
  on public.whatsapp_phone_numbers
  for each row execute function private.record_whatsapp_business_account();

-- ------------------------------------------------------------------ admin edits reset Meta's view
-- Replaces the 20261110100000 version: also drops Meta's status fields when the identifiers change.
create or replace function private.prepare_whatsapp_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    -- Signed-in admins never choose the credential: a new row gets the env form, an update keeps
    -- whatever the service role stored (env or vault).
    new.access_token_reference := case when tg_op = 'INSERT' then null else old.access_token_reference end;
    if tg_op = 'INSERT'
       or new.business_account_id is distinct from old.business_account_id
       or new.phone_number_id is distinct from old.phone_number_id then
      new.connection_status := 'pending_verification';
      new.webhook_configured := false;
      new.last_verified_at := null;
      new.verified_name := null;
      new.quality_rating := null;
      new.code_verification_status := null;
      new.name_status := null;
      new.meta_status := null;
    end if;
  end if;
  -- The env form is always the row's own company's variable, so a wrong env reference is replaced, not
  -- stored. A vault reference is left for the CHECK to validate.
  if new.access_token_reference is null or starts_with(new.access_token_reference, 'secret://env/') then
    new.access_token_reference := 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace(new.company_id::text, '-', ''));
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_whatsapp_account() from public;

-- ------------------------------------------------------------------ members never read the credential
revoke select on public.whatsapp_phone_numbers from authenticated;
grant select (id, company_id, business_account_id, phone_number_id, display_name, display_number, verified_name,
              quality_rating, code_verification_status, name_status, meta_status, webhook_configured,
              connection_status, last_verified_at, created_at, updated_at)
  on public.whatsapp_phone_numbers to authenticated;

-- ------------------------------------------------------------------ vault lookup follows the rename
-- Same contract as 20261110100000; the parameter is a whatsapp_phone_numbers id.
create or replace function public.whatsapp_account_access_token(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.whatsapp_phone_numbers a
  join vault.decrypted_secrets s on a.access_token_reference = 'secret://vault/' || s.id::text
  where a.id = p_account_id
    and (s.name = 'whatsapp_access_token:' || a.company_id::text
         or starts_with(s.name, 'whatsapp_access_token:' || a.company_id::text || ':'))
$$;
revoke all on function public.whatsapp_account_access_token(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_account_access_token(uuid) to service_role;
comment on function public.whatsapp_account_access_token(uuid) is
  'Service role only. The decrypted WhatsApp access token for the number''s (whatsapp_phone_numbers.id) secret://vault/<id> reference, or null when the reference is not a vault secret named for the number''s company.';
