-- Binds each company's WhatsApp access-token reference to that company.
--
-- whatsapp_accounts.access_token_reference names the worker environment variable that holds the
-- company's Meta access token. Company admins can edit the row, so the reference must not be able to
-- name another company's token: the worker resolves exactly
--   secret://env/WHATSAPP_ACCESS_TOKEN_<company id without dashes, upper case>
-- (backend/src/infrastructure/whatsapp/access-token.ts, whatsAppAccessTokenReference) and refuses
-- anything else. This constraint makes the database agree, so a wrong reference is rejected when it
-- is written instead of failing at delivery time.

alter table public.whatsapp_accounts
  add constraint whatsapp_accounts_token_reference_company_check
  check (access_token_reference = 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace(company_id::text, '-', '')));

comment on column public.whatsapp_accounts.access_token_reference is
  'secret://env/WHATSAPP_ACCESS_TOKEN_<company id without dashes, upper case>; the token lives only in the worker environment.';
