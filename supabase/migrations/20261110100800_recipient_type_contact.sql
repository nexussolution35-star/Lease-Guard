-- A WhatsApp contact as a message counterparty (ticket 05, inbound routing).
--
-- Until now every message was to or from a tenant or a property owner. A person who messages a
-- company's WhatsApp number may be neither: a prospective tenant, a supplier, anyone. Such a message is
-- recorded against a whatsapp_contacts row (next migration) with recipient_type 'contact'.
--
-- Its own migration: a new enum value cannot be used in the transaction that adds it.

alter type public.recipient_type add value if not exists 'contact';
