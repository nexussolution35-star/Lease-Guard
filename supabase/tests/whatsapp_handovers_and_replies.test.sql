-- Handovers and replies to contacts (20261110101100_whatsapp_handovers_and_replies): only a company's writers
-- accept, assign and resolve handovers of its conversations; replies to contacts are created approved by the writer
-- inside the 24-hour customer service window, from the conversation's number, and no free-form message can reach a
-- tenant. Members read their own company's handovers only.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(73);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.uid(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email
$$;
-- The fixture conversation of a company (with the fixture contact).
create function tests.conv(p_company uuid) returns uuid
language sql security definer set search_path = '' as $$
  select w.id from public.whatsapp_conversations w
  where w.company_id = p_company and w.contact_id in ('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002')
$$;
create function tests.handover(p_conversation uuid) returns public.whatsapp_handovers
language sql security definer set search_path = '' as $$
  select * from public.whatsapp_handovers h where h.conversation_id = p_conversation and h.status <> 'resolved'
$$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

-- ================================================================== shape and privileges
select has_table('public', 'whatsapp_handovers', 'handovers have a table');
select ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_handovers'::regclass), 'row level security is enabled on handovers');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_handovers', 'insert')
          and not has_table_privilege('authenticated', 'public.whatsapp_handovers', 'update')
          and not has_table_privilege('authenticated', 'public.whatsapp_handovers', 'delete'),
  'signed-in users never write handovers directly');
select ok(not has_table_privilege('anon', 'public.whatsapp_handovers', 'select'), 'anon reads no handovers');
select ok(not has_function_privilege('anon', 'public.accept_whatsapp_handover(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.assign_whatsapp_handover(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.resolve_whatsapp_handover(uuid, uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.reply_to_whatsapp_contact(uuid, uuid, text)', 'execute'),
  'anon cannot handle conversations or reply');
select ok(has_function_privilege('authenticated', 'public.accept_whatsapp_handover(uuid, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.reply_to_whatsapp_contact(uuid, uuid, text)', 'execute'),
  'signed-in users may call them (the functions check the role)');
select ok(not has_function_privilege('service_role', 'public.reply_to_whatsapp_contact(uuid, uuid, text)', 'execute'),
  'the backend never writes a reply on a person''s behalf');
select is((select prosecdef from pg_proc where oid = 'public.reply_to_whatsapp_contact(uuid, uuid, text)'::regprocedure), false,
  'a reply runs as the signed-in user, so every message guard applies');

-- ================================================================== handovers
-- An NS property manager accepts the fixture's open (agent) handover.
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.accept_whatsapp_handover(:ns, tests.conv(:ns))), 'accepted', 'a writer accepts the open handover');
select is((select row(status, assigned_user_id, accepted_at is not null, requested_by)::text from tests.handover(tests.conv(:ns))),
  row('accepted', tests.uid('naledi.vdmerwe@nexussolution.co.za'), true, 'agent')::text, 'it is accepted by them, still the agent''s request');
select is((select outcome from public.accept_whatsapp_handover(:ns, tests.conv(:ns))), 'already_accepted', 'accepting again changes nothing');
select is((select count(*) from public.whatsapp_handovers where company_id = :ns), 1::bigint, 'members read their company''s handovers');
select is((select count(*) from public.whatsapp_handovers where company_id = :kp), 0::bigint, 'and none of another company''s');
reset role;

-- Another NS manager.
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.accept_whatsapp_handover(:ns, tests.conv(:ns))), 'accepted_by_other',
  'a colleague cannot silently take an accepted conversation');
select is((select outcome from public.assign_whatsapp_handover(:ns, tests.conv(:ns), tests.uid('kabelo.molefe@nexussolution.co.za'))),
  'invalid_assignee', 'a read-only member cannot be assigned');
select is((select outcome from public.assign_whatsapp_handover(:ns, tests.conv(:ns), tests.uid('pieter@bothafamilytrust.co.za'))),
  'invalid_assignee', 'nor a property owner');
select is((select outcome from public.assign_whatsapp_handover(:ns, tests.conv(:ns), tests.uid('lerato@kgalagadiproperty.co.za'))),
  'invalid_assignee', 'nor a member of another company');
select is((select outcome from public.assign_whatsapp_handover(:ns, tests.conv(:ns), tests.uid('thandi.mokoena@nexussolution.co.za'))),
  'assigned', 'a writer assigns it to the company admin');
select is((select row(status, assigned_user_id, accepted_at is null)::text from tests.handover(tests.conv(:ns))),
  row('open', tests.uid('thandi.mokoena@nexussolution.co.za'), true)::text, 'which stays open until the assignee accepts');
select is((select outcome from public.assign_whatsapp_handover(:ns, tests.conv(:ns), tests.uid('sipho.dlamini@nexussolution.co.za'))),
  'assigned', 'a writer assigns it to themselves');
select is((select row(status, assigned_user_id)::text from tests.handover(tests.conv(:ns))),
  row('accepted', tests.uid('sipho.dlamini@nexussolution.co.za'))::text, 'which accepts it');
-- Company mix-ups: the conversation must be the named company's.
select is((select outcome from public.accept_whatsapp_handover(:kp, tests.conv(:ns))), 'not_found',
  'a conversation of another company is not found, even for a writer of both');
select is((select outcome from public.resolve_whatsapp_handover(:ns, gen_random_uuid())), 'not_found', 'an unknown conversation is not found');
reset role;

-- Read-only members, owners and other companies' members cannot act.
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.accept_whatsapp_handover(%L, %L)', :ns, tests.conv(:ns)), '42501', null,
  'a read-only member cannot accept');
select throws_ok(format('select * from public.assign_whatsapp_handover(%L, %L, %L)', :ns, tests.conv(:ns), tests.uid('kabelo.molefe@nexussolution.co.za')),
  '42501', null, 'nor assign');
select throws_ok(format('select * from public.resolve_whatsapp_handover(%L, %L)', :ns, tests.conv(:ns)), '42501', null, 'nor resolve');
select throws_ok(format('update public.whatsapp_handovers set status = %L', 'resolved'), '42501', null, 'nor write a handover directly');
reset role;
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.accept_whatsapp_handover(%L, %L)', :ns, tests.conv(:ns)), '42501', null,
  'a property owner cannot accept');
reset role;
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.resolve_whatsapp_handover(%L, %L)', :ns, tests.conv(:ns)), '42501', null,
  'a member of another company cannot resolve');
reset role;

-- Resolve, then take over again.
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.resolve_whatsapp_handover(:ns, tests.conv(:ns), '  Answered by phone  ')), 'resolved', 'a writer resolves it');
select is(
  (select row(status, resolved_by_user_id, resolved_at is not null, resolution_note)::text
   from public.whatsapp_handovers where conversation_id = tests.conv(:ns)),
  row('resolved', tests.uid('sipho.dlamini@nexussolution.co.za'), true, 'Answered by phone')::text, 'with who, when and the note');
select is((select outcome from public.resolve_whatsapp_handover(:ns, tests.conv(:ns))), 'no_handover', 'resolving again finds no handover');
select is((select outcome from public.accept_whatsapp_handover(:ns, tests.conv(:ns))), 'accepted', 'taking the conversation over again');
select is((select row(status, requested_by, requested_by_user_id, assigned_user_id)::text from tests.handover(tests.conv(:ns))),
  row('accepted', 'member', tests.uid('sipho.dlamini@nexussolution.co.za'), tests.uid('sipho.dlamini@nexussolution.co.za'))::text,
  'creates a handover requested and accepted by that member');
select is((select count(*) from public.whatsapp_handovers where conversation_id = tests.conv(:ns)), 2::bigint, 'the resolved one is kept');
reset role;
select throws_ok(
  format('insert into public.whatsapp_handovers (company_id, conversation_id, reason, requested_by) values (%L, %L, %L, %L)', :ns, tests.conv(:ns), 'Again', 'agent'),
  '23505', null, 'a conversation has at most one unresolved handover');
select throws_ok(
  format('insert into public.whatsapp_handovers (company_id, conversation_id, reason, requested_by) values (%L, %L, %L, %L)', :ns, tests.conv(:kp), 'Mixed', 'agent'),
  '23503', null, 'a handover belongs to a conversation of its own company');

-- ================================================================== replies to contacts
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:ns, tests.conv(:ns), 'Yes, parking is available.')), 'created',
  'a writer replies to a contact inside the window');
select is(
  (select row(direction, message_type, recipient_type, status, counterparty_number, company_number, contact_id, created_by_user_id)::text
   from public.communications where conversation_id = tests.conv(:ns) and direction = 'outbound'),
  row('outbound'::public.message_direction, 'manual'::public.message_type, 'contact'::public.recipient_type, 'approved'::public.delivery_status,
      '+27829000001', '+27 11 555 0100', '96000000-0000-4000-8000-000000000001'::uuid, tests.uid('naledi.vdmerwe@nexussolution.co.za'))::text,
  'it is an approved outbound message to the contact''s number from the conversation''s number');
select is(
  (select row(a.decision, a.requested_by_user_id, a.decided_by_user_id)::text
   from public.message_approvals a join public.communications c on c.id = a.communication_id
   where c.conversation_id = tests.conv(:ns) and c.direction = 'outbound'),
  row('approved'::public.approval_decision, tests.uid('naledi.vdmerwe@nexussolution.co.za'), tests.uid('naledi.vdmerwe@nexussolution.co.za'))::text,
  'approved by the writer who wrote it');
select throws_ok(format('select * from public.reply_to_whatsapp_contact(%L, %L, %L)', :ns, tests.conv(:ns), '   '), '22023', null,
  'an empty reply is refused');
select throws_ok(format('select * from public.reply_to_whatsapp_contact(%L, %L, %L)', :ns, tests.conv(:ns), repeat('x', 4097)), '22023', null,
  'a reply over 4 096 characters is refused');
select is((select outcome from public.reply_to_whatsapp_contact(:kp, tests.conv(:ns), 'Hi')), 'not_found',
  'a conversation of another company is not found');
reset role;

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.reply_to_whatsapp_contact(%L, %L, %L)', :ns, tests.conv(:ns), 'Hi'), '42501', null,
  'a read-only member cannot reply');
reset role;

-- The KP number is pending verification: nothing is sent from it.
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:kp, tests.conv(:kp), 'Hi')), 'number_not_connected',
  'no reply from a number that is not connected');
reset role;

-- The window closes 24 hours after the contact's last message.
update public.whatsapp_conversations set last_inbound_at = now() - interval '25 hours' where id = tests.conv(:ns);
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:ns, tests.conv(:ns), 'Late answer')), 'window_closed',
  'no reply after the window closed');
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id, counterparty_number, company_number, body, status)
           values (%L, 'whatsapp', 'outbound', 'manual', 'contact', '96000000-0000-4000-8000-000000000001', %L, '+27829000001', '+27 11 555 0100', 'Late', 'draft')$$,
         :ns, tests.conv(:ns)),
  '42501', null, 'nor a draft reply written directly');
reset role;
set local role service_role;
select throws_ok(
  format('select public.claim_communication(%L, (select id from public.communications where conversation_id = %L and direction = %L))', :ns, tests.conv(:ns), 'outbound'),
  '42501', null, 'and the delivery worker cannot claim an approved reply once the window has closed');
reset role;
update public.whatsapp_conversations set last_inbound_at = now() - interval '1 hour' where id = tests.conv(:ns);

-- Tenants never receive a free-form message.
set local role service_role;
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, (select number_id from public.whatsapp_conversations where id = tests.conv(:ns)),
     'wamid.tenant-1', null, '27821110001', 'Bongani', 'Statement query', now())),
  'recorded', 'an NS tenant writes in');
select is(
  (select outcome from public.record_whatsapp_inbound_message(:ns, (select number_id from public.whatsapp_conversations where id = tests.conv(:ns)),
     'wamid.bsuid-1', 'ZA.700800900', null, 'Lebo', 'Hello', now())),
  'recorded', 'a contact known only by a business-scoped user id writes in');
reset role;
create table tests.tenant_thread as
  select conversation_id, contact_id from public.communications where external_message_id = 'wamid.tenant-1';
create table tests.bsuid_thread as
  select conversation_id from public.communications where external_message_id = 'wamid.bsuid-1';
grant select on tests.tenant_thread, tests.bsuid_thread to authenticated, service_role;

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:ns, (select conversation_id from tests.tenant_thread), 'Hello')), 'tenant',
  'a reply to a tenant''s conversation is refused');
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id, counterparty_number, company_number, body, status)
           values (%L, 'whatsapp', 'outbound', 'manual', 'contact', %L, %L, '+27821110001', '+27 11 555 0100', 'Hello', 'draft')$$,
         :ns, (select contact_id from tests.tenant_thread), (select conversation_id from tests.tenant_thread)),
  '42501', null, 'a direct free-form message to a tenant''s contact is refused');
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id, counterparty_number, company_number, body, status)
           values (%L, 'whatsapp', 'outbound', 'manual', 'tenant', '50000000-0000-4000-8000-000000000001', '+27821110001', '+27 11 555 0100', 'Hello', 'draft')$$, :ns),
  '23514', null, 'and a free-form (manual) message addressed to the tenant is refused');
select is((select outcome from public.reply_to_whatsapp_contact(:ns, (select conversation_id from tests.bsuid_thread), 'Hello')), 'no_number',
  'a contact without a known number cannot be replied to yet');
-- A contact's message cannot be moved into another contact's conversation.
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id, counterparty_number, company_number, body, status)
           values (%L, 'whatsapp', 'outbound', 'manual', 'contact', '96000000-0000-4000-8000-000000000001', %L, '+27829000001', '+27 11 555 0100', 'Hi', 'draft')$$,
         :ns, (select conversation_id from tests.bsuid_thread)),
  '23514', null, 'a reply belongs to a conversation of its own contact');
reset role;

-- A tenant whose number is recorded after the contact last wrote (the contact is not linked yet): the number alone
-- makes the contact a tenant, verified or not, so no free-form reply reaches them.
update public.tenants set whatsapp_number = '+27829000001', whatsapp_verified = false where id = '50000000-0000-4000-8000-000000000001';
select is((select tenant_id from public.whatsapp_contacts where id = '96000000-0000-4000-8000-000000000001'), null::uuid,
  'the fixture contact is not linked to the renumbered tenant');
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:ns, tests.conv(:ns), 'Free-form text to a tenant')), 'tenant',
  'a reply to a contact whose number is a tenant''s is refused, although the contact is not linked yet');
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id, counterparty_number, company_number, body, status)
           values (%L, 'whatsapp', 'outbound', 'manual', 'contact', '96000000-0000-4000-8000-000000000001', %L, '+27829000001', '+27 11 555 0100', 'Hello', 'draft')$$,
         :ns, tests.conv(:ns)),
  '42501', null, 'nor written directly');
reset role;
set local role service_role;
select throws_ok(
  format('select public.claim_communication(%L, (select id from public.communications where conversation_id = %L and direction = %L))', :ns, tests.conv(:ns), 'outbound'),
  '42501', null, 'and the worker cannot claim an earlier approved reply to that number');
reset role;
update public.tenants set whatsapp_number = '+27821110001', whatsapp_verified = true where id = '50000000-0000-4000-8000-000000000001';

-- A contact later identified as a tenant: the approved reply is no longer claimable.
update public.whatsapp_contacts set tenant_id = '50000000-0000-4000-8000-000000000001' where id = '96000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok(
  format('select public.claim_communication(%L, (select id from public.communications where conversation_id = %L and direction = %L))', :ns, tests.conv(:ns), 'outbound'),
  '42501', null, 'the worker cannot claim a reply to a contact who turned out to be a tenant');
reset role;
update public.whatsapp_contacts set tenant_id = null where id = '96000000-0000-4000-8000-000000000001';
set local role service_role;
select isnt(
  (select public.claim_communication(:ns, (select id from public.communications where conversation_id = tests.conv(:ns) and direction = 'outbound'))),
  null, 'inside the window, to a contact, the worker claims the approved reply');
reset role;

-- The guard stops creating and claiming a reply only: once its contact turns out to be a tenant, every later
-- lifecycle step is still recorded (release, failure, and Meta's statuses for a reply already sent).
create table tests.reply_one as
  select id, send_uncertain_since as claim from public.communications where conversation_id = tests.conv(:ns) and direction = 'outbound' and status = 'queued';
grant select on tests.reply_one to service_role;
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.reply_to_whatsapp_contact(:ns, tests.conv(:ns), 'A second answer')), 'created', 'a second reply is written');
reset role;
create table tests.reply_two as
  select id from public.communications where conversation_id = tests.conv(:ns) and direction = 'outbound' and status = 'approved';
grant select on tests.reply_two to service_role;
set local role service_role;
select isnt((select public.claim_communication(:ns, (select id from tests.reply_two))), null, 'the worker claims the second reply');
select is((select public.record_communication_sent(:ns, (select id from tests.reply_two), 'wamid.reply-2')), 'recorded',
  'and records it sent');
reset role;
update public.whatsapp_contacts set tenant_id = '50000000-0000-4000-8000-000000000001' where id = '96000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select public.release_communication_claim(:ns, (select id from tests.reply_one), (select claim from tests.reply_one))), true,
  'a claimed reply to a contact who turned out to be a tenant can be released');
select is((select public.record_communication_failed(:ns, (select id from tests.reply_one), 'This contact is a tenant', false)), true,
  'and failed by the delivery worker');
select is((select public.record_communication_provider_status(:ns, 'wamid.reply-2', 'delivered', now())), 'advanced',
  'Meta''s delivered status for a sent reply is recorded after its contact is linked to a tenant');
select is((select public.record_communication_provider_status(:ns, 'wamid.reply-2', 'read', now())), 'advanced',
  'and its read status');
reset role;
select is(array[(select status::text from public.communications where id = (select id from tests.reply_one)),
                (select status::text from public.communications where id = (select id from tests.reply_two))],
  array['failed', 'read'], 'the first reply failed and the second was read');
update public.whatsapp_contacts set tenant_id = null where id = '96000000-0000-4000-8000-000000000001';

-- KP sees none of NS's replies or handovers.
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is((select count(*) from public.communications where company_id = :ns and recipient_type = 'contact' and direction = 'outbound'), 0::bigint,
  'another company reads no reply');
select is((select count(*) from public.whatsapp_handovers where company_id = :ns), 0::bigint, 'nor a handover');
select is((select count(*) from public.whatsapp_handovers), 1::bigint, 'only its own');
reset role;

-- Inbound contact messages are still recorded as before.
select is((select count(*) from public.communications where external_message_id = 'wamid.bsuid-1' and recipient_type = 'contact' and direction = 'inbound'),
  1::bigint, 'inbound contact messages are unchanged');

select * from finish();
rollback;
