-- WhatsApp setup, test messages and activation (20261111100200_whatsapp_setup_and_test_messages): the ten setup steps
-- come from verified facts only; a test message counts only once Meta reports it delivered or read; WhatsApp cannot be
-- activated (by anyone, the service role included) until every required step is done; test messages are company-scoped,
-- admin-only and never go to a tenant.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(48);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- The steps of a company as "step:state" in order (as the postgres owner, no access check).
create function tests.steps(p_company uuid) returns text[]
language sql security definer set search_path = '' as $$
  select array_agg(s.step || ':' || s.state order by s.step_order) from private.whatsapp_setup_steps(p_company) s
$$;
grant execute on function tests.steps(uuid) to authenticated, service_role;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

select id as ns_number from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = 'phone-ns' \gset
select id as kp_number from public.whatsapp_phone_numbers where company_id = :kp and phone_number_id = 'phone-kp' \gset
select id as ns_template from public.whatsapp_message_templates where company_id = :ns \gset
select id as kp_template from public.whatsapp_message_templates where company_id = :kp \gset

-- ================================================================== privileges
select ok(not has_function_privilege('anon', 'public.whatsapp_setup_status(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.whatsapp_setup_status(uuid)', 'execute'),
  'signed-in users (not anon) may ask for a setup status');
select ok(not has_function_privilege('authenticated', 'private.whatsapp_setup_steps(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.whatsapp_setup_ready(uuid)', 'execute'),
  'the internal computation is not callable by signed-in users');
select ok(not has_function_privilege('authenticated', 'public.record_whatsapp_test_message_status(uuid, text, text, timestamptz, text)', 'execute')
          and has_function_privilege('service_role', 'public.record_whatsapp_test_message_status(uuid, text, text, timestamptz, text)', 'execute'),
  'only the worker records Meta''s status of a test message');
select ok(not has_function_privilege('anon', 'public.request_whatsapp_test_message(uuid, uuid, uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.activate_company_whatsapp(uuid)', 'execute'),
  'anon can neither request a test message nor activate');
select is((select array_agg(distinct coalesce(array_to_string(p.proconfig, ','), '')) from pg_proc p
           where p.proname in ('request_whatsapp_test_message', 'abandon_whatsapp_test_message', 'whatsapp_setup_status',
                               'activate_company_whatsapp', 'deactivate_company_whatsapp', 'whatsapp_setup_steps', 'whatsapp_setup_ready')
             and p.prosecdef),
  array['search_path=""'], 'every SECURITY DEFINER function has an empty search_path');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_test_messages', 'insert')
          and not has_table_privilege('authenticated', 'public.whatsapp_test_messages', 'update')
          and not has_table_privilege('authenticated', 'public.whatsapp_test_messages', 'delete')
          and not has_table_privilege('anon', 'public.whatsapp_test_messages', 'select'),
  'nobody signed in writes test messages; anon reads nothing');
select is((select count(*) from pg_constraint where contype = 'f' and conrelid = 'public.companies'::regclass
           and confrelid = 'public.company_users'::regclass), 0::bigint,
  'no foreign key from companies to company_users: the Data API''s company_users -> companies embed stays unambiguous');
select ok(not has_column_privilege('authenticated', 'public.companies', 'whatsapp_activated_at', 'update'),
  'members cannot set the activation directly');

-- ================================================================== steps from verified facts
select is(tests.steps(:ns), array[
  'business_profile:done', 'meta_account:done', 'business_account:done', 'phone_number:done', 'webhook:done',
  'message_templates:done', 'ai_agent:done', 'knowledge_base:done', 'test_message:action_needed', 'ready_for_activation:blocked'],
  'a connected number with an approved utility template: everything but the test message');
select is(tests.steps(:kp), array[
  'business_profile:done', 'meta_account:action_needed', 'business_account:blocked', 'phone_number:blocked', 'webhook:blocked',
  'message_templates:blocked', 'ai_agent:done', 'knowledge_base:done', 'test_message:blocked', 'ready_for_activation:blocked'],
  'a typed number with no stored token is not a Meta account: later steps are blocked');

-- What an admin types is not verified: KP's pending number with webhook_configured set by hand and a token-scope pass.
update public.whatsapp_phone_numbers set webhook_configured = true where id = :'kp_number';
update public.whatsapp_business_accounts set access_token_reference = 'secret://vault/00000000-0000-4000-8000-0000000000aa'
 where company_id = :kp;
select is(tests.steps(:kp), array[
  'business_profile:done', 'meta_account:done', 'business_account:done', 'phone_number:action_needed', 'webhook:action_needed',
  'message_templates:waiting_on_meta', 'ai_agent:done', 'knowledge_base:done', 'test_message:blocked', 'ready_for_activation:blocked'],
  'a stored token and a passed scope check: the account is verified, the number and webhook are not yet');

insert into public.whatsapp_number_verification_steps (company_id, number_id, step, status)
values (:kp, :'kp_number', 'phone_number', 'pending');
select is((select array_agg(s.state order by s.step_order) from private.whatsapp_setup_steps(:kp) s where s.step in ('phone_number', 'webhook')),
  array['waiting_on_meta', 'waiting_on_meta'], 'while verification runs the number and webhook steps wait on Meta');
update public.whatsapp_number_verification_steps set status = 'passed' where company_id = :kp and number_id = :'kp_number' and step = 'phone_number';
insert into public.whatsapp_number_verification_steps (company_id, number_id, step, status)
values (:kp, :'kp_number', 'registration', 'action_needed'), (:kp, :'kp_number', 'webhook_subscription', 'passed');
select is((select array_agg(s.state order by s.step_order) from private.whatsapp_setup_steps(:kp) s where s.step in ('phone_number', 'webhook')),
  array['action_needed', 'done'], 'Meta lists the number but it still needs registering; the webhook subscription passed');
update public.whatsapp_number_verification_steps set status = 'not_required' where company_id = :kp and number_id = :'kp_number' and step = 'registration';
select is((select s.state from private.whatsapp_setup_steps(:kp) s where s.step = 'phone_number'), 'done',
  'a number Meta lists that needs no registration is verified');

update public.whatsapp_knowledge_faqs set status = 'draft', approved_at = null where company_id = :kp;
update public.whatsapp_knowledge_entries set status = 'draft', approved_at = null where company_id = :kp;
update public.whatsapp_knowledge_documents set status = 'draft', approved_at = null where company_id = :kp;
delete from public.whatsapp_agent_configs where company_id = :kp;
select is((select array_agg(s.state || ':' || s.required order by s.step_order) from private.whatsapp_setup_steps(:kp) s
           where s.step in ('ai_agent', 'knowledge_base')),
  array['action_needed:false', 'action_needed:false'], 'drafts are not a knowledge base; agent and knowledge are recommended, not required');

-- ================================================================== who reads the status
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_setup_status(:ns)), 10::bigint, 'a read-only member reads their company''s ten steps');
select throws_ok(format('select * from public.whatsapp_setup_status(%L)', :kp), '42501', null,
  'but not another company''s');
reset role;

-- ================================================================== test messages
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.request_whatsapp_test_message(%L, %L, %L, %L)', :ns, :'ns_number', :'ns_template', '+27829990001'),
  '42501', null, 'a property manager cannot send a test message');
select throws_ok(format('select public.activate_company_whatsapp(%L)', :ns), '42501', null, 'or activate WhatsApp');
reset role;

select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(format('select * from public.request_whatsapp_test_message(%L, %L, %L, %L)', :kp, :'kp_number', :'kp_template', '+27829990001'),
  '42501', null, 'an admin cannot send a test message for another company');
select is((select outcome from public.request_whatsapp_test_message(:ns, :'kp_number', :'ns_template', '+27829990001')), 'number_not_found',
  'nor from another company''s number');
select is((select outcome from public.request_whatsapp_test_message(:ns, :'ns_number', :'kp_template', '+27829990001')), 'template_not_found',
  'nor with another company''s template');
select is((select outcome from public.request_whatsapp_test_message(:ns, :'ns_number', :'ns_template', '+27821110001')), 'tenant',
  'a tenant''s number never receives a test message');
select throws_ok(format('select * from public.request_whatsapp_test_message(%L, %L, %L, %L)', :ns, :'ns_number', :'ns_template', '082 999 0001'),
  '22023', null, 'the recipient must be in international format');
select is((select outcome from public.request_whatsapp_test_message(:ns, :'ns_number', :'ns_template', '+27829990001')), 'created',
  'an admin sends an approved template from a connected number');
select is((select row(status, template_name, template_language, to_number, requested_by_user_id)::text from public.whatsapp_test_messages
           where company_id = :ns and to_number = '+27829990001'),
  row('queued', 'monthly_statement', 'en_ZA', '+27829990001', '10000000-0000-4000-8000-000000000001'::uuid)::text,
  'it is queued with the template''s Meta name and language, and who asked');
select is((select array_agg(distinct company_id) from public.whatsapp_test_messages), array[:ns::uuid], 'the admin reads their company''s test messages only');
select throws_ok(format('update public.whatsapp_test_messages set status = %L', 'delivered'), '42501', null, 'and cannot mark one delivered');
select is((select s.state from public.whatsapp_setup_status(:ns) s where s.step = 'test_message'), 'waiting_on_meta',
  'a queued test message waits on Meta');
select is(public.activate_company_whatsapp(:ns), 'not_ready', 'activation is refused until the test message is delivered');
reset role;

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_test_messages), 0::bigint, 'members who are not admins do not read test messages');
reset role;

update public.whatsapp_phone_numbers set connection_status = 'pending_verification' where id = :'ns_number';
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.request_whatsapp_test_message(:ns, :'ns_number', :'ns_template', '+27829990001')), 'number_not_connected',
  'a number that is not connected cannot send a test message');
reset role;
update public.whatsapp_phone_numbers set connection_status = 'connected' where id = :'ns_number';
update public.whatsapp_message_templates set status = 'PAUSED' where id = :'ns_template';
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select is((select outcome from public.request_whatsapp_test_message(:ns, :'ns_number', :'ns_template', '+27829990001')), 'template_not_approved',
  'a template Meta has not approved cannot be sent');
reset role;
update public.whatsapp_message_templates set status = 'APPROVED' where id = :'ns_template';

-- The worker sends it and Meta reports statuses, in any order.
set local role service_role;
update public.whatsapp_test_messages set status = 'sent', provider_message_id = 'wamid.test-1', sent_at = now() where company_id = :ns and to_number = '+27829990001';
select is(public.record_whatsapp_test_message_status(:kp, 'wamid.test-1', 'delivered', now(), null), 'not_found',
  'another company''s status never touches this test message');
select is((select s.state from private.whatsapp_setup_steps(:ns) s where s.step = 'test_message'), 'waiting_on_meta',
  'sent is not enough');
select is(public.record_whatsapp_test_message_status(:ns, 'wamid.test-1', 'read', now(), null), 'advanced', 'read advances');
select is(public.record_whatsapp_test_message_status(:ns, 'wamid.test-1', 'delivered', now(), null), 'recorded',
  'a late delivered only fills its time');
select is(public.record_whatsapp_test_message_status(:ns, 'wamid.test-1', 'failed', now(), 'late'), 'unchanged',
  'failed after delivery evidence changes nothing');
select is((select row(status, delivered_at is not null, read_at is not null)::text from public.whatsapp_test_messages where provider_message_id = 'wamid.test-1'),
  row('read', true, true)::text, 'the test message is read with both times');
reset role;
select is((tests.steps(:ns))[9:10], array['test_message:done', 'ready_for_activation:done'],
  'a delivered or read test message completes the step and the company is ready');

-- ================================================================== activation
set local role service_role;
select throws_ok(format('update public.companies set whatsapp_activated_at = now() where id = %L', :kp), '23514', null,
  'not even the service role can mark a company active while a required step is not done');
reset role;
select throws_ok(format('insert into public.companies (name, address_line1, suburb, city, province, postal_code, contact_email, contact_phone, initials, whatsapp_activated_at) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, now())',
  'New Co', '1 Main Road', 'Sandton', 'Johannesburg', 'Gauteng', '2196', 'info@new.co.za', '+27 11 555 0300', 'NC'), '23514', null,
  'a new company cannot start active');

select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select is(public.activate_company_whatsapp(:ns), 'activated', 'a company admin activates once every required step is done');
select is(public.activate_company_whatsapp(:ns), 'already_active', 'activating again changes nothing');
select is((select whatsapp_activated_by_user_id from public.companies where id = :ns), '10000000-0000-4000-8000-000000000001'::uuid,
  'the activation records who activated');
select is(public.deactivate_company_whatsapp(:ns), true, 'a company admin deactivates');
select is((select row(whatsapp_activated_at, whatsapp_activated_by_user_id)::text from public.companies where id = :ns), row(null::timestamptz, null::uuid)::text,
  'deactivation clears both');
select throws_ok(format('select public.activate_company_whatsapp(%L)', :kp), '42501', null, 'an admin cannot activate another company');
reset role;

select * from finish();
rollback;
