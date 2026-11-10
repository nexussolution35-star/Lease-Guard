-- Inbound WhatsApp routing (20261110100900_whatsapp_inbound_routing): a message is recorded for the company
-- whose CONNECTED number received it, once per Meta message id and company; the sender only identifies the
-- contact within that company (by business-scoped user id or number), a same-company tenant is linked, and
-- messages thread into one conversation per receiving number and contact. Members read their own company's
-- contacts, conversations and messages only; raw webhook payloads are service role only.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(45);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Counts as the database owner, whatever role the test is impersonating.
create function tests.owner_count(p_table text, p_company uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where company_id = $1', p_table) into n using p_company;
  return n;
end $$;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

-- Both companies' numbers connected (the fixture's KP number is pending).
update public.whatsapp_phone_numbers set connection_status = 'connected' where phone_number_id = 'phone-kp';
create table tests.numbers as
  select company_id, id from public.whatsapp_phone_numbers where phone_number_id in ('phone-ns', 'phone-kp');
grant select on tests.numbers to service_role, authenticated;
create function tests.num(p_company uuid) returns uuid language sql security definer set search_path = '' as $$
  select id from tests.numbers where company_id = p_company
$$;
grant execute on function tests.num(uuid) to service_role, authenticated;

-- ================================================================== shape and privileges
select has_table('public', 'whatsapp_webhook_events', 'raw webhook payloads have a table');
select has_table('public', 'whatsapp_contacts', 'WhatsApp contacts have a table');
select has_table('public', 'whatsapp_conversations', 'WhatsApp conversations have a table');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.whatsapp_webhook_events'::regclass, 'public.whatsapp_contacts'::regclass, 'public.whatsapp_conversations'::regclass)),
  'row level security is enabled on all three');
select ok(not has_function_privilege('authenticated', 'public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz)', 'execute'),
  'signed-in users and anon cannot record inbound messages');
select ok(has_function_privilege('service_role', 'public.record_whatsapp_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz)', 'execute'),
  'the worker (service role) records inbound messages');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_webhook_events', 'select')
          and not has_table_privilege('anon', 'public.whatsapp_webhook_events', 'select'),
  'members never read raw webhook payloads');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_contacts', 'insert')
          and not has_table_privilege('authenticated', 'public.whatsapp_conversations', 'update'),
  'signed-in users do not write contacts or conversations');

-- ================================================================== routing, as the worker
set local role service_role;

select is(
  (select row(outcome, communication_id is not null)::text from public.record_whatsapp_inbound_message(
     :ns, tests.num(:ns), 'wamid.in-1', null, '27829990001', 'Ayanda', 'Is parking available?', now() - interval '1 minute')),
  row('recorded', true)::text, 'a message to the NS number is recorded for NS');
select is(
  (select outcome from public.record_whatsapp_inbound_message(
     :ns, tests.num(:ns), 'wamid.in-1', null, '27829990001', 'Ayanda', 'Is parking available?', now() - interval '1 minute')),
  'duplicate', 'the same message delivered again is recognised');
select is((select count(*) from public.communications where company_id = :ns and external_message_id = 'wamid.in-1'), 1::bigint,
  'and recorded once');
select is(
  (select row(direction, status, message_type, recipient_type, counterparty_number, company_number, body, tenant_id is null, received_at is not null)::text
   from public.communications where external_message_id = 'wamid.in-1'),
  row('inbound'::public.message_direction, 'received'::public.delivery_status, 'inbound_reply'::public.message_type, 'contact'::public.recipient_type,
      '+27829990001', '+27 11 555 0100', 'Is parking available?', true, true)::text,
  'it is an inbound message from a contact, with the sender''s number and the receiving number');

-- The same sender writes to KP's number: a separate contact, conversation and message in KP.
select is(
  (select outcome from public.record_whatsapp_inbound_message(
     :kp, tests.num(:kp), 'wamid.in-1', null, '27829990001', 'Ayanda', 'Do you have offices to let?', now())),
  'recorded', 'the same sender (and even the same message id) at KP is recorded for KP');
select is((select count(*) from public.whatsapp_contacts where company_id = :ns and wa_id = '27829990001'), 1::bigint, 'NS has one contact for the sender');
select is((select count(*) from public.whatsapp_contacts where company_id = :kp and wa_id = '27829990001'), 1::bigint, 'KP has its own contact for the sender');
select isnt(
  (select id from public.whatsapp_contacts where company_id = :ns and wa_id = '27829990001'),
  (select id from public.whatsapp_contacts where company_id = :kp and wa_id = '27829990001'),
  'the two companies never share a contact');

-- Unknown, wrong-company and disconnected numbers are dropped.
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:kp), 'wamid.in-x', null, '27829990001', null, 'Hi', now())),
  'unknown_number', 'a number of another company is not this company''s receiving number');
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, gen_random_uuid(), 'wamid.in-y', null, '27829990001', null, 'Hi', now())),
  'unknown_number', 'an unknown number id is dropped');
select is((select count(*) from public.communications where external_message_id in ('wamid.in-x', 'wamid.in-y')), 0::bigint,
  'nothing is recorded for a dropped message');

-- Threading: a second message from the same contact joins the conversation and moves its window.
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:ns), 'wamid.in-2', null, '27829990001', null, 'Thanks', now())),
  'recorded', 'a second message is recorded');
select is((select count(*) from public.whatsapp_conversations w join public.whatsapp_contacts k on k.id = w.contact_id
           where w.company_id = :ns and k.wa_id = '27829990001'), 1::bigint, 'and threads into the same conversation');
select is(
  (select count(distinct conversation_id) from public.communications where company_id = :ns and external_message_id in ('wamid.in-1', 'wamid.in-2')),
  1::bigint, 'both messages carry that conversation');
select ok(
  (select w.last_inbound_at > now() - interval '5 seconds' from public.whatsapp_conversations w
   join public.whatsapp_contacts k on k.id = w.contact_id where w.company_id = :ns and k.wa_id = '27829990001'),
  'the conversation''s last inbound time is the latest message');
select is((select profile_name from public.whatsapp_contacts where company_id = :ns and wa_id = '27829990001'), 'Ayanda',
  'a message without a profile name keeps the one already known');

-- Business-scoped user ids: Meta may omit the number.
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:ns), 'wamid.in-3', 'ZA.100200300', null, 'Lebo', 'Hello', now())),
  'recorded', 'a sender identified only by a business-scoped user id is recorded');
select is(
  (select row(recipient_type, counterparty_number is null)::text from public.communications where external_message_id = 'wamid.in-3'),
  row('contact'::public.recipient_type, true)::text, 'its message has no sender number');
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:ns), 'wamid.in-4', 'ZA.100200300', '27829990002', 'Lebo', 'Me again', now())),
  'recorded', 'the same user id with a number is recorded');
select is(
  (select row(count(*), max(wa_id))::text from public.whatsapp_contacts where company_id = :ns and user_id = 'ZA.100200300'),
  row(1::bigint, '27829990002')::text, 'as the same contact, whose number is now known');
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:ns), 'wamid.in-5', 'ZA.555', '27829990001', null, 'New id', now())),
  'recorded', 'a number already known as a contact is recognised when a user id first appears');
select is((select user_id from public.whatsapp_contacts where company_id = :ns and wa_id = '27829990001'), 'ZA.555',
  'and the user id is recorded on that contact');
select throws_ok(
  format('select * from public.record_whatsapp_inbound_message(%L, %L, %L, null, null, null, %L, now())', :ns, tests.num(:ns), 'wamid.in-6', 'Hi'),
  '22023', null, 'a sender with neither a user id nor a number is refused');

-- Tenants: linked only within the company that received the message.
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, tests.num(:ns), 'wamid.in-7', null, '27821110001', 'Bongani', 'Statement query', now())),
  'recorded', 'a message from an NS tenant''s number is recorded');
select is(
  (select row(recipient_type, tenant_id)::text from public.communications where external_message_id = 'wamid.in-7'),
  row('tenant'::public.recipient_type, '50000000-0000-4000-8000-000000000001'::uuid)::text,
  'it is linked to that NS tenant');
select is(
  (select outcome from public.record_whatsapp_inbound_message(:kp, tests.num(:kp), 'wamid.in-8', null, '27821110001', 'Bongani', 'Hello KP', now())),
  'recorded', 'the same person writing to KP is recorded for KP');
select is(
  (select row(recipient_type, tenant_id is null)::text from public.communications where external_message_id = 'wamid.in-8'),
  row('contact'::public.recipient_type, true)::text,
  'and is a KP contact, never linked to the NS tenant');

-- A disconnected number receives nothing.
reset role;
update public.whatsapp_phone_numbers set connection_status = 'disconnected' where phone_number_id = 'phone-kp';
set local role service_role;
select is(
  (select outcome from public.record_whatsapp_inbound_message(:kp, tests.num(:kp), 'wamid.in-9', null, '27829990001', null, 'Hi', now())),
  'unknown_number', 'a message to a disconnected number is dropped');

-- Raw payloads are stored once.
insert into public.whatsapp_webhook_events (payload_sha256, payload, received_at) values (repeat('a', 64), '{"object":"whatsapp_business_account"}', now());
select throws_ok(
  $$insert into public.whatsapp_webhook_events (payload_sha256, payload, received_at) values (repeat('a', 64), '{}', now())$$,
  '23505', null, 'the same payload is stored once');
reset role;

-- ================================================================== isolation for members
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_contacts), 4::bigint, 'an NS member sees the NS contacts (the fixture''s and three new)');
select is((select count(*) from public.whatsapp_contacts where company_id = :kp), 0::bigint, 'and none of KP''s');
select is((select count(*) from public.whatsapp_conversations where company_id = :kp), 0::bigint, 'nor KP''s conversations');
select is((select count(*) from public.communications where company_id = :kp and direction = 'inbound'), 0::bigint, 'nor KP''s messages');
select throws_ok($$select count(*) from public.whatsapp_webhook_events$$, '42501', null, 'nor any raw webhook payload');
reset role;

select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_conversations where company_id = :ns), 0::bigint, 'a KP member sees no NS conversation');
select is((select count(*) from public.whatsapp_conversations), 3::bigint, 'only KP''s own three');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.whatsapp_contacts$$, '42501', null, 'anon reads no contacts');
reset role;

select * from finish();
rollback;
