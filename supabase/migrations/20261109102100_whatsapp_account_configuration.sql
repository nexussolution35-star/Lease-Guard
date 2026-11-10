-- Company WhatsApp configuration (onboarding step) by the company_admin.
--
-- * A company_admin may insert and update only the Meta identifiers and display fields
--   (business_account_id, phone_number_id, display_name, display_number). company_id is also
--   updatable so a PostgREST upsert (ON CONFLICT (company_id) DO UPDATE) works; prevent_company_change
--   still refuses any actual change.
-- * access_token_reference is always set by trigger to the company-bound reference
--   ('secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(company id without dashes)); the token itself
--   only lives in the worker environment. The CHECK from 20261109100700 stays.
-- * connection_status, webhook_configured and last_verified_at are recorded by the service role only
--   (the worker verifies the connection). A row an admin creates starts 'pending_verification', and
--   changing the business account or phone number id sends it back to 'pending_verification', so a
--   verified state never carries over to different Meta identifiers.
-- * No deletes by signed-in users.

revoke insert, update, delete on public.whatsapp_accounts from authenticated;
grant insert (company_id, business_account_id, phone_number_id, display_name, display_number)
  on public.whatsapp_accounts to authenticated;
grant update (company_id, business_account_id, phone_number_id, display_name, display_number)
  on public.whatsapp_accounts to authenticated;

drop policy admins_delete on public.whatsapp_accounts;
-- admins_insert / admins_update (company_admin of the row's company) stay, see 20261109101100.

create function private.prepare_whatsapp_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.access_token_reference := 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace(new.company_id::text, '-', ''));
  if current_user = 'authenticated'
     and (tg_op = 'INSERT'
          or new.business_account_id is distinct from old.business_account_id
          or new.phone_number_id is distinct from old.phone_number_id) then
    new.connection_status := 'pending_verification';
    new.webhook_configured := false;
    new.last_verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_whatsapp_account() from public;

create trigger prepare_account before insert or update on public.whatsapp_accounts
  for each row execute function private.prepare_whatsapp_account();
