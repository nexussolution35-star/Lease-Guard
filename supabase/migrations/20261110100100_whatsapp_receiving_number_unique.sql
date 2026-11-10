-- One receiving WhatsApp number belongs to exactly one company: the company whose account for it is
-- connected.
--
-- The shared Meta webhook identifies the company from value.metadata.phone_number_id (ADR 0002), so two
-- companies owning the same phone_number_id would make routing ambiguous and could deliver one company's
-- inbound messages to another.
--
-- Ownership follows verification, not what an admin typed. A company_admin can enter any
-- phone_number_id, but the row stays 'pending_verification' until the service role verifies it with
-- Meta (20261109102100). So the uniqueness covers connected rows only. A pending row cannot lock the
-- real owner out of its own number, and a 409 cannot tell an admin which numbers other companies hold.
-- The partial index also serves the webhook's lookup, which only trusts connected rows.

create unique index whatsapp_accounts_connected_phone_number_id_key
  on public.whatsapp_accounts (phone_number_id)
  where connection_status = 'connected';
