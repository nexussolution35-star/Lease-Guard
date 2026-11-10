-- WhatsApp access tokens may live in Supabase Vault as well as in the worker environment.
--
-- whatsapp_accounts.access_token_reference now takes one of two forms (the TypeScript side of the same
-- rule is backend/src/infrastructure/whatsapp/access-token-reference.ts; the parity test in
-- supabase/tests/whatsapp_channel.test.sql keeps the two in step):
--   secret://env/WHATSAPP_ACCESS_TOKEN_<company id without dashes, upper case>
--     a worker environment variable, still bound to the row's own company (20261109100700);
--   secret://vault/<vault secret uuid, lower case>
--     a Supabase Vault secret. Embedded Signup will store each business's token this way.
--
-- A vault secret is bound to a company by its name: 'whatsapp_access_token:<company id>' or
-- 'whatsapp_access_token:<company id>:<anything>'. public.whatsapp_account_access_token only returns a
-- secret whose name names the account's own company, so a reference that points at another company's
-- secret (or at any other vault secret) resolves to nothing.
--
-- Signed-in users still never choose the reference: they have no column grant on it (20261109102100),
-- and the trigger below derives the env form on insert and keeps the stored reference on update. Only
-- the service role (and the database owner) can set a vault reference.

create extension if not exists supabase_vault;

-- ------------------------------------------------------------------ reference shape
-- Immutable so the CHECK can use it; the parity test calls it directly. The CHECK runs as the writing
-- role, so admins (who write the row) and the service role need execute; it reveals nothing.
create function private.is_whatsapp_token_reference(p_reference text, p_company_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_reference = 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace(p_company_id::text, '-', ''))
      or p_reference ~ '^secret://vault/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
revoke all on function private.is_whatsapp_token_reference(text, uuid) from public;
grant execute on function private.is_whatsapp_token_reference(text, uuid) to authenticated, service_role;

alter table public.whatsapp_accounts drop constraint whatsapp_accounts_token_reference_company_check;
alter table public.whatsapp_accounts
  add constraint whatsapp_accounts_token_reference_check
  check (private.is_whatsapp_token_reference(access_token_reference, company_id));

comment on column public.whatsapp_accounts.access_token_reference is
  'secret://env/WHATSAPP_ACCESS_TOKEN_<company id hex, upper case> (worker environment) or secret://vault/<vault secret uuid> (Supabase Vault, secret named whatsapp_access_token:<company id>[:…]). Set by the service role; never the token itself.';

-- ------------------------------------------------------------------ who sets the reference
-- Replaces the 20261109102100 version, which always forced the env form.
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

-- ------------------------------------------------------------------ vault lookup for the worker
-- The decrypted token of one account's vault reference, or null when the account has no vault
-- reference, the secret does not exist, or the secret is not named for the account's company.
-- The reference is read from the row here, never taken from the caller, so the worker cannot be talked
-- into reading an arbitrary secret. Service role only: the token must never reach a signed-in user.
create function public.whatsapp_account_access_token(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.whatsapp_accounts a
  join vault.decrypted_secrets s on a.access_token_reference = 'secret://vault/' || s.id::text
  where a.id = p_account_id
    and (s.name = 'whatsapp_access_token:' || a.company_id::text
         or starts_with(s.name, 'whatsapp_access_token:' || a.company_id::text || ':'))
$$;
revoke all on function public.whatsapp_account_access_token(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_account_access_token(uuid) to service_role;
comment on function public.whatsapp_account_access_token(uuid) is
  'Service role only. The decrypted WhatsApp access token for the account''s secret://vault/<id> reference, or null when the reference is not a vault secret named for the account''s company.';
