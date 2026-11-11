-- AI agent runs (20261111100100_whatsapp_agent_runs): one run per inbound message, completed once; the agent's reply
-- to a contact is agent-approved and re-checked (never a tenant, inside the window, the out-of-hours message at most
-- once per window); handovers notify the handover contacts once; members read only their company's runs; only the
-- worker writes them.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(63);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.ns_number() returns uuid
language sql security definer set search_path = '' as $$
  select id from public.whatsapp_phone_numbers where phone_number_id = 'phone-ns'
$$;
-- Records an inbound message to NS's number and returns its communication id.
create function tests.inbound(p_message_id text, p_wa_id text, p_body text) returns uuid
language sql security definer set search_path = '' as $$
  select communication_id from public.record_whatsapp_inbound_message(
    '20000000-0000-4000-8000-000000000001', tests.ns_number(), p_message_id, null, p_wa_id, 'Visitor', p_body, now())
$$;
create function tests.run_of(p_communication uuid) returns public.whatsapp_agent_runs
language sql security definer set search_path = '' as $$
  select * from public.whatsapp_agent_runs where communication_id = p_communication
$$;
-- complete_whatsapp_agent_run with the usage left out.
create function tests.complete(p_run uuid, p_outcome text, p_reason text, p_reply text, p_since timestamptz default null)
returns table (outcome text, run_outcome text, reply_communication_id uuid, handover_id uuid, notified integer)
language sql set search_path = '' as $$
  select * from public.complete_whatsapp_agent_run('20000000-0000-4000-8000-000000000001', p_run, p_outcome, 'faq', 0.9,
    p_reason, 'Suggested answer', p_reply, p_since, 'claude-opus-5-5', 'end_turn', 1200, 80, 1000, 0, 900, null)
$$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

-- ================================================================== shape and privileges
select has_table('public', 'whatsapp_agent_runs', 'agent runs have a table');
select ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_agent_runs'::regclass), 'row level security is enabled on agent runs');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_agent_runs', 'insert')
          and not has_table_privilege('authenticated', 'public.whatsapp_agent_runs', 'update')
          and not has_table_privilege('authenticated', 'public.whatsapp_agent_runs', 'delete'),
  'signed-in users never write agent runs');
select ok(not has_table_privilege('anon', 'public.whatsapp_agent_runs', 'select'), 'anon reads no agent runs');
select ok(not has_function_privilege('authenticated', 'public.start_whatsapp_agent_run(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.start_whatsapp_agent_run(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.complete_whatsapp_agent_run(uuid, uuid, text, text, numeric, text, text, text, timestamptz, text, text, integer, integer, integer, integer, integer, text)', 'execute')
          and not has_function_privilege('anon', 'public.complete_whatsapp_agent_run(uuid, uuid, text, text, numeric, text, text, text, timestamptz, text, text, integer, integer, integer, integer, integer, text)', 'execute'),
  'only the worker starts and completes agent runs');
select ok(not has_column_privilege('authenticated', 'public.message_approvals', 'decided_by_agent_run_id', 'insert')
          and not has_column_privilege('authenticated', 'public.message_approvals', 'decided_by_agent_run_id', 'update'),
  'a signed-in user can never record an approval as the agent''s');
select ok(has_column_privilege('authenticated', 'public.message_approvals', 'decision', 'update')
          and has_column_privilege('authenticated', 'public.message_approvals', 'communication_id', 'insert'),
  'writers keep their approval columns');

-- ================================================================== one run per message
set local role service_role;
select tests.inbound('wamid.agent-1', '27820000111', 'Where do visitors park?') as m1 \gset
select is((select outcome from public.start_whatsapp_agent_run(:ns, :'m1')), 'started', 'the first run of a message starts');
select is((select outcome from public.start_whatsapp_agent_run(:ns, :'m1')), 'running', 'a retry finds the unfinished run');
select is((select count(*) from public.whatsapp_agent_runs where communication_id = :'m1'), 1::bigint, 'one run per message');
select is((select outcome from public.start_whatsapp_agent_run(:kp, :'m1')), 'not_found', 'another company cannot run the agent on it');
select (tests.run_of(:'m1')).id as r1 \gset

-- ================================================================== a reply to a contact
select is((select row(outcome, run_outcome, notified)::text from tests.complete(:'r1', 'replied', null, 'Visitors park on level P2.')),
  row('completed', 'replied', 0)::text, 'the run completes with the reply');
select (tests.run_of(:'m1')).reply_communication_id as reply1 \gset
select is((select row(direction, recipient_type, status, message_type, counterparty_number, body)::text from public.communications where id = :'reply1'),
  row('outbound', 'contact', 'approved', 'manual', '+27820000111', 'Visitors park on level P2.')::text,
  'the reply is an approved outbound message to the contact');
select is((select row(decision, decided_by_user_id, decided_by_agent_run_id, requested_by_user_id)::text from public.message_approvals where communication_id = :'reply1'),
  row('approved', null::uuid, :'r1'::uuid, null::uuid)::text, 'approved by the agent run, by no person');
select is((select row(status, outcome, category, confidence, model, input_tokens, output_tokens, cache_read_input_tokens, latency_ms, suggested_reply, completed_at is not null)::text
           from public.whatsapp_agent_runs where id = :'r1'),
  row('completed', 'replied', 'faq', 0.900, 'claude-opus-5-5', 1200, 80, 1000, 900, 'Suggested answer', true)::text,
  'the run records its outcome and usage');
select is((select row(outcome, run_outcome, reply_communication_id)::text from tests.complete(:'r1', 'replied', null, 'Again')),
  row('already_completed', 'replied', :'reply1'::uuid)::text, 'completing again sends nothing new');
select is((select row(outcome, reply_communication_id)::text from public.start_whatsapp_agent_run(:ns, :'m1')),
  row('completed', :'reply1'::uuid)::text, 'a retried job finds the run done, with its reply to deliver');
select is((select count(*) from public.communications where conversation_id = (tests.run_of(:'m1')).conversation_id and direction = 'outbound'),
  1::bigint, 'one reply was ever created');

-- The backend cannot approve a message other than as the agent's reply.
select lives_ok(format($$
  insert into public.communications (company_id, channel, direction, message_type, recipient_type, contact_id, conversation_id, counterparty_number, company_number, body, status)
  select r.company_id, 'whatsapp', 'outbound', 'manual', 'contact', w.contact_id, w.id, '+27820000111', '+27 11 555 0100', 'Direct', 'pending_approval'
  from public.whatsapp_agent_runs r join public.whatsapp_conversations w on w.id = r.conversation_id where r.communication_id = %L
$$, :'m1'), 'the backend creates an approval request');
select throws_ok($$
  update public.communications set status = 'approved' where body = 'Direct'
$$, '42501', null, 'but cannot approve it outside the agent''s run');

-- ================================================================== out of hours: once per window
select tests.inbound('wamid.agent-2', '27820000111', 'Are you open?') as m2 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m2')) as r2 \gset
select is((select row(outcome, run_outcome, reply_communication_id is not null, handover_id is not null, notified)::text
           from tests.complete(:'r2', 'out_of_hours', 'The message arrived outside operating hours', 'We are closed until 08:00.', now() - interval '2 hours')),
  row('completed', 'out_of_hours', true, true, 1)::text, 'the out-of-hours message is sent, a handover opened, the handover contact told');
select is((select row(status, requested_by, reason)::text from public.whatsapp_handovers where id = (tests.run_of(:'m2')).handover_id),
  row('open', 'agent', 'The message arrived outside operating hours')::text, 'the handover is the agent''s, with the reason');
select is((select row(user_id, type, severity, link_entity_type, link_entity_id)::text from public.notifications
           where dedupe_key like 'whatsapp-handover:%' and company_id = :ns),
  row('10000000-0000-4000-8000-000000000002'::uuid, 'system', 'warning', 'communication', :'m2'::uuid)::text,
  'the notification goes to the configured handover contact and links the message');

select tests.inbound('wamid.agent-3', '27820000111', 'Hello?') as m3 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m3')) as r3 \gset
select is((select row(outcome, run_outcome, reply_communication_id, notified)::text
           from tests.complete(:'r3', 'out_of_hours', 'The message arrived outside operating hours', 'We are closed until 08:00.', now() - interval '2 hours')),
  row('completed', 'handed_over', null::uuid, 0)::text, 'not sent again in the same window; no second handover or notification');
select is((tests.run_of(:'m3')).handover_id, (tests.run_of(:'m2')).handover_id, 'the conversation keeps its one unresolved handover');
select is((select count(*) from public.communications where body = 'We are closed until 08:00.'), 1::bigint, 'one out-of-hours message');

select ok((tests.run_of(:'m3')).handover_reason like '%A person is handling this conversation%',
  'the unresolved handover keeps the agent quiet');

-- Once a person resolves the handover, the out-of-hours message is still sent at most once per window.
reset role;
update public.whatsapp_handovers set status = 'resolved', resolved_at = now() where id = (tests.run_of(:'m2')).handover_id;
set local role service_role;
select tests.inbound('wamid.agent-3b', '27820000111', 'Still there?') as m3b \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m3b')) as r3b \gset
select is((select row(outcome, run_outcome, reply_communication_id)::text
           from tests.complete(:'r3b', 'out_of_hours', 'The message arrived outside operating hours', 'We are closed until 08:00.', now() - interval '2 hours')),
  row('completed', 'handed_over', null::uuid)::text, 'not sent again in the same window after the handover is resolved');
select is((select count(*) from public.communications where body = 'We are closed until 08:00.'), 1::bigint, 'still one out-of-hours message');

-- A new window (since after the first one) sends it again.
reset role;
update public.whatsapp_handovers set status = 'resolved', resolved_at = now() where id = (tests.run_of(:'m3b')).handover_id;
set local role service_role;
select tests.inbound('wamid.agent-4', '27820000111', 'Morning?') as m4 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m4')) as r4 \gset
select is((select run_outcome from tests.complete(:'r4', 'out_of_hours', 'The message arrived outside operating hours', 'We are closed until 08:00.', now() + interval '1 second')),
  'out_of_hours', 'a later window gets the out-of-hours message again');

-- ================================================================== never a tenant
-- Dlamini Cellular (an NS tenant) writes from its WhatsApp number.
select tests.inbound('wamid.agent-5', '27821110001', 'Where do visitors park?') as m5 \gset
select is((select recipient_type from public.communications where id = :'m5'), 'tenant'::public.recipient_type, 'the sender is a tenant');
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m5')) as r5 \gset
select is((select row(outcome, run_outcome, reply_communication_id)::text from tests.complete(:'r5', 'replied', null, 'Visitors park on level P2.')),
  row('completed', 'handed_over', null::uuid)::text, 'a reply meant for a tenant is never created: the run hands over');
select ok((tests.run_of(:'m5')).handover_reason like '%tenant%', 'with the tenant reason');
select is((select count(*) from public.communications where tenant_id = '50000000-0000-4000-8000-000000000001' and direction = 'outbound' and body = 'Visitors park on level P2.'),
  0::bigint, 'nothing was written to the tenant');
select is((tests.run_of(:'m5')).suggested_reply, 'Suggested answer', 'staff keep the internal suggestion');

-- A contact who turns out to share a tenant's number is a tenant too (whatsapp_contact_tenant_id).
select tests.inbound('wamid.agent-6', '27820000222', 'Hi') as m6 \gset
reset role;
update public.tenants set whatsapp_number = '+27820000222' where id = '50000000-0000-4000-8000-000000000003';
set local role service_role;
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m6')) as r6 \gset
select is((select run_outcome from tests.complete(:'r6', 'replied', null, 'Hello there.')), 'handed_over',
  'a contact with a tenant''s number is never answered either');

-- ================================================================== the window and the number
select tests.inbound('wamid.agent-7', '27820000333', 'Parking?') as m7 \gset
reset role;
update public.whatsapp_conversations set last_inbound_at = now() - interval '25 hours'
where id = (select conversation_id from public.communications where id = :'m7');
set local role service_role;
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m7')) as r7 \gset
select is((select row(run_outcome, reply_communication_id)::text from tests.complete(:'r7', 'replied', null, 'Level P2.')),
  row('handed_over', null::uuid)::text, 'no free-form message after the 24-hour window');
select ok((tests.run_of(:'m7')).handover_reason like '%24-hour%', 'with the window reason');

select tests.inbound('wamid.agent-8', '27820000444', 'Parking?') as m8 \gset
reset role;
update public.whatsapp_phone_numbers set connection_status = 'disconnected' where phone_number_id = 'phone-ns';
set local role service_role;
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m8')) as r8 \gset
select is((select run_outcome from tests.complete(:'r8', 'replied', null, 'Level P2.')), 'handed_over', 'nor from a number that is not connected');
reset role;
update public.whatsapp_phone_numbers set connection_status = 'connected' where phone_number_id = 'phone-ns';
set local role service_role;

-- ================================================================== a person takes over, or auto-reply goes off, during the model call
select tests.inbound('wamid.agent-12', '27820000777', 'Where do visitors park?') as m12 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m12')) as r12 \gset
select (select conversation_id from public.communications where id = :'m12') as c12 \gset
reset role;
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.accept_whatsapp_handover(:ns, :'c12')), 'accepted', 'a property manager takes the conversation over');
reset role;
select set_config('request.jwt.claims', '', true);
select (select id from public.whatsapp_handovers where conversation_id = :'c12' and status <> 'resolved') as h12 \gset
set local role service_role;
select is((select row(outcome, run_outcome, reply_communication_id, handover_id, notified)::text from tests.complete(:'r12', 'replied', null, 'Visitors park on level P2.')),
  row('completed', 'handed_over', null::uuid, :'h12'::uuid, 0)::text,
  'the agent''s answer is not sent once a person has taken over; the person''s handover is kept, nobody re-notified');
select is((tests.run_of(:'m12')).handover_reason, 'A person is handling this conversation', 'with the reason');
select is((select count(*) from public.communications where conversation_id = :'c12' and direction = 'outbound'), 0::bigint,
  'nothing was written to the contact');
select tests.inbound('wamid.agent-12b', '27820000777', 'Hello?') as m12b \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m12b')) as r12b \gset
select is((select row(run_outcome, reply_communication_id)::text
           from tests.complete(:'r12b', 'out_of_hours', 'The message arrived outside operating hours', 'We are closed until 08:00.', now() - interval '2 hours')),
  row('handed_over', null::uuid)::text, 'nor the out-of-hours message');

select tests.inbound('wamid.agent-13', '27820000888', 'Where do visitors park?') as m13 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m13')) as r13 \gset
reset role;
update public.whatsapp_agent_configs set auto_reply_enabled = false where company_id = :ns;
set local role service_role;
select is((select row(run_outcome, reply_communication_id)::text from tests.complete(:'r13', 'replied', null, 'Visitors park on level P2.')),
  row('handed_over', null::uuid)::text, 'auto-reply turned off during the model call: the answer is not sent');
select ok((tests.run_of(:'m13')).handover_reason like '%Auto-reply is off%', 'with the auto-reply reason');
reset role;
update public.whatsapp_agent_configs set auto_reply_enabled = true where company_id = :ns;
set local role service_role;

-- ================================================================== other outcomes and inputs
select tests.inbound('wamid.agent-9', '27820000555', 'Thanks!') as m9 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m9')) as r9 \gset
select is((select row(run_outcome, reply_communication_id, handover_id)::text from tests.complete(:'r9', 'ignored', null, null)),
  row('ignored', null::uuid, null::uuid)::text, 'an ignored message gets nothing');
select tests.inbound('wamid.agent-10', '27820000555', 'Complaint') as m10 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m10')) as r10 \gset
select throws_ok(format($$ select * from tests.complete(%L, 'handed_over', null, null) $$, :'r10'), '22023', null, 'a handover needs a reason');
select throws_ok(format($$ select * from tests.complete(%L, 'replied', null, null) $$, :'r10'), '22023', null, 'a reply needs its text');
select throws_ok(format($$ select * from tests.complete(%L, 'handed_over', 'x', 'text') $$, :'r10'), '22023', null, 'a handover sends no text');
select throws_ok(format($$ select * from tests.complete(%L, 'out_of_hours', 'x', 'text', null) $$, :'r10'), '22023', null, 'out-of-hours names its window');
select throws_ok(format($$ select * from tests.complete(%L, 'sent', 'x', null) $$, :'r10'), '22023', null, 'an unknown outcome is refused');
select is((select row(run_outcome, notified)::text from tests.complete(:'r10', 'handed_over', 'A complaint: a person must respond', null)),
  row('handed_over', 1)::text, 'a complaint is handed to a person and the handover contact told');
select is((select count(*) from public.complete_whatsapp_agent_run(:kp, :'r10', 'ignored', null, null, null, null, null, null, null, null, null, null, null, null, null, null) where outcome = 'not_found'),
  1::bigint, 'another company cannot complete the run');

-- Without configured handover contacts, the company's admins and property managers are told (never read-only
-- members or owners).
reset role;
delete from public.whatsapp_agent_handover_contacts where company_id = :ns;
set local role service_role;
select tests.inbound('wamid.agent-11', '27820000666', 'Complaint') as m11 \gset
select (select run_id from public.start_whatsapp_agent_run(:ns, :'m11')) as r11 \gset
select is((select notified from tests.complete(:'r11', 'handed_over', 'A complaint: a person must respond', null)), 3, 'the three writers told');
select is((select array_agg(user_id order by user_id)::text from public.notifications
           where company_id = :ns and dedupe_key like 'whatsapp-handover:' || (tests.run_of(:'m11')).handover_id::text || ':%'),
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000003}',
  'the company admin and the property managers');
reset role;

-- ================================================================== isolation
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select ok((select count(*) from public.whatsapp_agent_runs where company_id = :ns) >= 10, 'members read their company''s runs, read-only members included');
select ok((select suggested_reply from public.whatsapp_agent_runs where id = :'r5') = 'Suggested answer', 'and the internal suggestion');
select throws_ok($$ update public.whatsapp_agent_runs set outcome = 'replied' $$, '42501', null, 'but never change them');
select throws_ok(format($$ insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decided_by_agent_run_id) values (%L, %L, %L, %L) $$,
  :ns, :'reply1', '10000000-0000-4000-8000-000000000004', :'r1'), '42501', null, 'nor record an approval as the agent''s');
reset role;
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_agent_runs where company_id = :ns), 0::bigint, 'another company''s members read none of them');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.whatsapp_agent_runs $$, '42501', null, 'anon reads nothing');
reset role;

-- An agent approval is never on a person's request or a pending decision.
select throws_ok(format($$ update public.message_approvals set decision = 'pending', decided_at = null where communication_id = %L $$, :'reply1'),
  '23514', null, 'an agent approval cannot be reopened');

select * from finish();
rollback;
