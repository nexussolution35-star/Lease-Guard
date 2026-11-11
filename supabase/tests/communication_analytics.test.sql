-- Communication analytics (ticket 12): public.communication_analytics(company, from, to) counts a company's WhatsApp
-- messages, handovers and AI agent runs over South African calendar days (both inclusive). Members of the company
-- only; it runs as the caller (security invoker), so Row Level Security applies too.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(17);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- The figures as one comparable text row.
create function tests.figures(p_company uuid, p_from date, p_to date) returns text
language sql set search_path = '' as $$
  select format('in=%s out=%s delivered=%s read=%s failed=%s handovers=%s by_agent=%s replies=%s out_of_hours=%s suggested=%s',
    a.inbound_messages, a.outbound_messages, a.delivered_messages, a.read_messages, a.failed_messages,
    a.handovers_opened, a.handovers_by_agent, a.agent_replies, a.out_of_hours_messages, a.suggested_replies)
  from public.communication_analytics(p_company, p_from, p_to) a
$$;
grant execute on function tests.figures(uuid, date, date) to authenticated;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''
select (now() at time zone 'Africa/Johannesburg')::date as today \gset
select id as ns_number from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = 'phone-ns' \gset

-- ================================================================== privileges
select ok(not has_function_privilege('anon', 'public.communication_analytics(uuid, date, date)', 'execute')
          and has_function_privilege('authenticated', 'public.communication_analytics(uuid, date, date)', 'execute'),
  'signed-in users (not anon) may ask for communication analytics');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.communication_analytics(uuid, date, date)'::regprocedure), false,
  'it runs as the caller, so Row Level Security applies');
select is((select array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.communication_analytics(uuid, date, date)'::regprocedure),
  'search_path=""', 'with an empty search_path');

-- ================================================================== a dated day for NS (15 Jan 2026, SAST = UTC+2)
insert into public.whatsapp_contacts (id, company_id, wa_id, first_message_at, last_message_at)
values ('96000000-0000-4000-8000-0000000000a1', :ns, '27829000101', '2026-01-15 09:00+02', '2026-01-15 09:00+02');
insert into public.whatsapp_conversations (id, company_id, number_id, contact_id, last_inbound_at, last_message_at)
values ('97000000-0000-4000-8000-0000000000a1', :ns, :'ns_number', '96000000-0000-4000-8000-0000000000a1', '2026-01-15 09:00+02', '2026-01-15 09:00+02');

insert into public.communications (id, company_id, channel, direction, message_type, recipient_type, tenant_id, owner_user_id, contact_id, conversation_id,
  counterparty_number, company_number, body, status, external_message_id, sent_at, delivered_at, read_at, failure_reason, created_at)
values
  -- Inbound from a contact, at the first second of the day and late in the day.
  ('98000000-0000-4000-8000-000000000001', :ns, 'whatsapp', 'inbound', 'inbound_reply', 'contact', null, null, '96000000-0000-4000-8000-0000000000a1', '97000000-0000-4000-8000-0000000000a1',
   '+27829000101', '+27115550100', 'What are your hours?', 'received', 'wamid.an-1', null, null, null, null, '2026-01-15 00:00+02'),
  ('98000000-0000-4000-8000-000000000002', :ns, 'whatsapp', 'inbound', 'inbound_reply', 'contact', null, null, '96000000-0000-4000-8000-0000000000a1', '97000000-0000-4000-8000-0000000000a1',
   '+27829000101', '+27115550100', 'Is there parking?', 'received', 'wamid.an-2', null, null, null, null, '2026-01-15 23:59+02'),
  -- Outbound to an owner: read, delivered, failed, queued.
  ('98000000-0000-4000-8000-000000000003', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 1', 'read', 'wamid.an-3', '2026-01-15 10:00+02', '2026-01-15 10:01+02', '2026-01-15 10:02+02', null, '2026-01-15 10:00+02'),
  ('98000000-0000-4000-8000-000000000004', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 2', 'delivered', 'wamid.an-4', '2026-01-15 10:00+02', '2026-01-15 10:01+02', null, null, '2026-01-15 10:00+02'),
  ('98000000-0000-4000-8000-000000000005', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 3', 'failed', 'wamid.an-5', '2026-01-15 10:00+02', null, null, 'Fixture: undeliverable', '2026-01-15 10:00+02'),
  -- Not handed to WhatsApp: awaiting approval, rejected, a draft. Not WhatsApp: an email.
  ('98000000-0000-4000-8000-000000000007', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 5', 'pending_approval', null, null, null, null, null, '2026-01-15 10:00+02'),
  ('98000000-0000-4000-8000-000000000008', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 6', 'rejected', null, null, null, null, null, '2026-01-15 10:00+02'),
  ('98000000-0000-4000-8000-000000000009', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 7', 'draft', null, null, null, null, null, '2026-01-15 10:00+02'),
  ('98000000-0000-4000-8000-000000000010', :ns, 'email', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary by email', 'sent', null, '2026-01-15 10:00+02', null, null, null, '2026-01-15 10:00+02'),
  -- The day before (23:59 SAST) and the day after (00:00 SAST): outside the day.
  ('98000000-0000-4000-8000-000000000011', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', null, '10000000-0000-4000-8000-000000000005', null, null,
   '+27825501194', '+27115550100', 'Summary 8', 'sent', 'wamid.an-11', '2026-01-14 23:59+02', null, null, null, '2026-01-14 23:59+02'),
  ('98000000-0000-4000-8000-000000000012', :ns, 'whatsapp', 'inbound', 'inbound_reply', 'contact', null, null, '96000000-0000-4000-8000-0000000000a1', '97000000-0000-4000-8000-0000000000a1',
   '+27829000101', '+27115550100', 'Thanks', 'received', 'wamid.an-12', null, null, null, null, '2026-01-16 00:00+02');

-- Queued: claimed for sending, outcome not yet known.
insert into public.communications (id, company_id, channel, direction, message_type, recipient_type, owner_user_id,
  counterparty_number, company_number, body, status, send_uncertain_since, created_at)
values ('98000000-0000-4000-8000-000000000006', :ns, 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner', '10000000-0000-4000-8000-000000000005',
  '+27825501194', '+27115550100', 'Summary 4', 'queued', '2026-01-15 10:00+02', '2026-01-15 10:00+02');

-- The agent answered the first message and sent the out-of-hours message for the second; a member took the
-- conversation over that day.
insert into public.whatsapp_agent_runs (company_id, conversation_id, communication_id, status, outcome, category, confidence, model, completed_at, created_at)
values
  (:ns, '97000000-0000-4000-8000-0000000000a1', '98000000-0000-4000-8000-000000000001', 'completed', 'replied', 'faq', 0.95, 'claude-opus-5-5', '2026-01-15 00:00+02', '2026-01-15 00:00+02'),
  (:ns, '97000000-0000-4000-8000-0000000000a1', '98000000-0000-4000-8000-000000000002', 'completed', 'out_of_hours', null, null, null, '2026-01-15 23:59+02', '2026-01-15 23:59+02'),
  (:ns, '97000000-0000-4000-8000-0000000000a1', '98000000-0000-4000-8000-000000000012', 'completed', 'handed_over', 'other', 0.4, 'claude-opus-5-5', '2026-01-16 00:00+02', '2026-01-16 00:00+02');
insert into public.whatsapp_handovers (company_id, conversation_id, reason, requested_by, requested_by_user_id, created_at)
values (:ns, '97000000-0000-4000-8000-0000000000a1', 'Taking this one', 'member', '10000000-0000-4000-8000-000000000003', '2026-01-15 12:00+02');

-- ================================================================== figures, as members
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is(tests.figures(:ns, '2026-01-15', '2026-01-15'),
  'in=2 out=4 delivered=2 read=1 failed=1 handovers=1 by_agent=0 replies=1 out_of_hours=1 suggested=0',
  'a read-only member sees one South African day: WhatsApp messages handed for sending, delivery, handovers and agent runs');
select is(tests.figures(:ns, '2026-01-14', '2026-01-16'),
  'in=3 out=5 delivered=2 read=1 failed=1 handovers=1 by_agent=0 replies=1 out_of_hours=1 suggested=0',
  'widening the range takes in the day before and the day after');
select is(tests.figures(:ns, '2025-12-01', '2025-12-31'),
  'in=0 out=0 delivered=0 read=0 failed=0 handovers=0 by_agent=0 replies=0 out_of_hours=0 suggested=0',
  'a range without activity is all zeros');
select is(tests.figures(:ns, :'today', :'today'),
  'in=1 out=2 delivered=1 read=0 failed=0 handovers=1 by_agent=1 replies=0 out_of_hours=0 suggested=1',
  'today: the fixture''s inbound reply, sent and delivered messages, the agent''s handover and its suggested reply');
reset role;

select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is(tests.figures(:kp, :'today', :'today'),
  'in=0 out=0 delivered=0 read=0 failed=0 handovers=1 by_agent=1 replies=0 out_of_hours=0 suggested=1',
  'KP''s member sees only KP''s figures (its message awaits approval, so nothing went out)');
select throws_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2026-01-15', '2026-01-15'), '42501', null,
  'a member of another company cannot read NS''s figures');
reset role;

-- A member of both companies sees each company's own figures, never the sum.
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select is(tests.figures(:kp, '2026-01-15', '2026-01-15'),
  'in=0 out=0 delivered=0 read=0 failed=0 handovers=0 by_agent=0 replies=0 out_of_hours=0 suggested=0',
  'a member of both companies asking for KP sees none of NS''s day');
select is(tests.figures(:ns, '2026-01-15', '2026-01-15'),
  'in=2 out=4 delivered=2 read=1 failed=1 handovers=1 by_agent=0 replies=1 out_of_hours=1 suggested=0',
  'and NS''s figures when asking for NS');

-- ================================================================== the range
select throws_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2026-01-16', '2026-01-15'), '22023', null,
  'the end cannot be before the start');
select throws_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2024-01-01', '2025-01-01'), '22023', null,
  'at most 366 days');
select lives_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2024-01-01', '2024-12-31'),
  '366 days (a leap year) is allowed');
select throws_ok(format('select * from public.communication_analytics(%L, null, %L)', :ns, '2026-01-15'), '22023', null,
  'both dates are required');
reset role;

-- ================================================================== who may ask
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2026-01-15', '2026-01-15'), '42501', null,
  'nobody signed in: the database owner without a user is refused too');
set local role anon;
select throws_ok(format('select * from public.communication_analytics(%L, %L, %L)', :ns, '2026-01-15', '2026-01-15'), '42501', null,
  'anon cannot call it');
reset role;

select * from finish();
rollback;
