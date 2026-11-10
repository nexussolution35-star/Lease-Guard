-- Number verification (20261110100700_whatsapp_number_verification): a number becomes connected only when
-- every recorded verification step passed; a failed step leaves it in error and says which; template sync
-- records Meta's catalogue and reflects it onto the company's templates; company admins disconnect a number,
-- which removes its stored token. Members read their own company's steps and templates only.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(55);

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

-- A pending NS number signed up through Embedded Signup, with its token in Vault and its session exchanged.
insert into public.whatsapp_business_accounts (company_id, business_account_id) values (:ns, '771001');
create table tests.secret as
  select vault.create_secret('EAAG-verification-token-0123456789', 'whatsapp_access_token:20000000-0000-4000-8000-000000000001:onboarding:t1') as id;
update public.whatsapp_business_accounts set access_token_reference = 'secret://vault/' || (select id from tests.secret)
where company_id = :ns and business_account_id = '771001';
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number,
  access_token_reference, connection_status)
values (:ns, '771001', '660001', '', '', 'secret://vault/' || (select id from tests.secret), 'pending_verification');
insert into public.whatsapp_onboarding_sessions (company_id, started_by, state_hash, status, phone_number_id, messaging_account_ids, finished_at)
values (:ns, '10000000-0000-4000-8000-000000000001', repeat('c', 64), 'exchanged', '660001', '{771001}', now());
create table tests.num as select id from public.whatsapp_phone_numbers where phone_number_id = '660001';
grant select on tests.num to authenticated;

create function tests.record(p_step public.whatsapp_verification_step, p_status public.whatsapp_verification_step_status)
returns void language sql set search_path = '' as $$
  insert into public.whatsapp_number_verification_steps (company_id, number_id, step, status, checked_at)
  values ('20000000-0000-4000-8000-000000000001', (select id from tests.num), p_step, p_status, now())
  on conflict (number_id, step) do update set status = excluded.status
$$;

-- ================================================================== privileges
select ok(not has_table_privilege('authenticated', 'public.whatsapp_number_verification_steps', 'insert, update, delete'),
  'signed-in users cannot write verification steps');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_message_templates', 'insert, update, delete'),
  'signed-in users cannot write synced templates');
select ok(not has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'registration_blocked_until', 'update'),
  'signed-in users cannot lift a registration lock');
select ok(not has_function_privilege('authenticated', 'public.finish_whatsapp_number_verification(uuid, uuid)', 'execute'),
  'signed-in users cannot mark a number verified');
select ok(not has_function_privilege('authenticated', 'public.sync_whatsapp_message_templates(uuid, text, jsonb)', 'execute'),
  'signed-in users cannot sync templates');
select ok(not has_function_privilege('anon', 'public.disconnect_whatsapp_number(uuid, uuid)', 'execute'), 'anon cannot disconnect');
select ok(has_function_privilege('service_role', 'public.finish_whatsapp_number_verification(uuid, uuid)', 'execute'),
  'the worker (service role) decides the status');
select is((select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.proname = 'disconnect_whatsapp_number' and p.prosecdef),
  'search_path=""', 'disconnect is SECURITY DEFINER with an empty search_path');

-- ================================================================== connected only after every step
select tests.record('token_scopes', 'passed');
select tests.record('phone_number', 'passed');
select tests.record('webhook_subscription', 'passed');
select tests.record('registration', 'action_needed');
select is(public.finish_whatsapp_number_verification(:ns, (select id from tests.num)), 'pending_verification'::public.whatsapp_connection_status,
  'a step waiting for the admin (and a missing step) keeps the number pending');
select is((select webhook_configured from public.whatsapp_phone_numbers where id = (select id from tests.num)), true,
  'the webhook subscription is recorded as soon as it passed');
select tests.record('registration', 'not_required');
select tests.record('message_templates', 'failed');
select is(public.finish_whatsapp_number_verification(:ns, (select id from tests.num)), 'error'::public.whatsapp_connection_status,
  'a failed step puts the number in error');
select is((select connection_status::text from public.whatsapp_phone_numbers where id = (select id from tests.num)), 'error',
  'partial success is never connected');
select tests.record('message_templates', 'passed');
select is(public.finish_whatsapp_number_verification(:ns, (select id from tests.num)), 'connected'::public.whatsapp_connection_status,
  'every step passed or not required: connected');
select ok((select last_verified_at is not null and webhook_configured from public.whatsapp_phone_numbers where id = (select id from tests.num)),
  'connecting records the verification time and the webhook');
select is((select status::text from public.whatsapp_onboarding_sessions where phone_number_id = '660001'), 'completed',
  'the signup that brought the number is completed');
select is(public.finish_whatsapp_number_verification(:ns, (select id from tests.num)), 'connected'::public.whatsapp_connection_status,
  'finishing again is idempotent');
select throws_ok(format('select public.finish_whatsapp_number_verification(%L, %L)', :kp, (select id from tests.num)), 'P0002', null,
  'a number is only ever finished for its own company');

-- Another company cannot connect the same receiving number.
insert into public.whatsapp_business_accounts (company_id, business_account_id) values (:kp, '771001');
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, connection_status)
values (:kp, '771001', '660001', '', '', 'pending_verification');
insert into public.whatsapp_number_verification_steps (company_id, number_id, step, status)
select :kp, n.id, s, 'passed' from public.whatsapp_phone_numbers n, unnest(enum_range(null::public.whatsapp_verification_step)) s
where n.company_id = :kp and n.phone_number_id = '660001';
select is(public.finish_whatsapp_number_verification(:kp, (select id from public.whatsapp_phone_numbers where company_id = :kp and phone_number_id = '660001')),
  'error'::public.whatsapp_connection_status, 'a number another company holds connected is not connected');
select alike((select message from public.whatsapp_number_verification_steps s join public.whatsapp_phone_numbers n on n.id = s.number_id
             where n.company_id = :kp and n.phone_number_id = '660001' and s.step = 'phone_number'),
  '%already connected to another LeaseGuard workspace%', 'and its phone number step says why');

-- ================================================================== admin edits reset results
update public.whatsapp_phone_numbers set registration_blocked_until = now() + interval '72 hours'
where company_id = :kp and phone_number_id = '660001';
update public.whatsapp_phone_numbers set phone_number_id = '660009' where company_id = :kp and phone_number_id = '660001';
select is((select count(*) from public.whatsapp_number_verification_steps s join public.whatsapp_phone_numbers n on n.id = s.number_id
           where n.company_id = :kp and n.phone_number_id = '660009'), 0::bigint, 'changing the Meta ids drops earlier step results');
select is((select registration_blocked_until from public.whatsapp_phone_numbers where company_id = :kp and phone_number_id = '660009'), null,
  'and the registration lock of the previous number');

-- ================================================================== template sync
select is(public.sync_whatsapp_message_templates(:ns, '771001', '[
  {"id": "1001", "name": "monthly_statement_v1", "language": "en", "category": "UTILITY", "status": "APPROVED"},
  {"id": "1002", "name": "payment_reminder", "language": "en_ZA", "category": "UTILITY", "status": "REJECTED", "rejected_reason": "INVALID_FORMAT"},
  {"id": "1003", "name": "promo", "language": "en", "category": "marketing", "status": "pending"}]'::jsonb), 3, 'three templates synced');
select is((select array_agg(row(name, language, category, status, rejected_reason)::text order by meta_template_id)
           from public.whatsapp_message_templates where company_id = :ns and business_account_id = '771001'),
  array[row('monthly_statement_v1', 'en', 'UTILITY', 'APPROVED', null)::text,
        row('payment_reminder', 'en_ZA', 'UTILITY', 'REJECTED', 'INVALID_FORMAT')::text,
        row('promo', 'en', 'MARKETING', 'PENDING', null)::text],
  'templates are recorded with category, language and status');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'),
  'approved', 'Meta''s approval is reflected onto the company''s own template');
select is((select approval_status::text from public.message_templates where company_id = :kp and meta_template_name = 'monthly_statement_v1'),
  'draft', 'another company''s template with the same name is untouched');
-- Company templates Meta stops holding: one only this account had, one another account of the company holds.
insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body, approval_status)
values
  (:ns, 'Overdue reminder', 'overdue_payment_reminder', 'tenant', 'overdue_reminder_v1', 'en', 'utility', 'Good day. Your account is overdue.', 'approved'),
  (:ns, 'Initial reminder', 'initial_payment_reminder', 'tenant', 'initial_reminder_v1', 'en', 'utility', 'Good day. A payment is due.', 'submitted'),
  (:ns, 'Statement (ZA)', 'monthly_statement', 'tenant', 'monthly_statement', 'en_ZA', 'utility', 'Good day. Your statement is attached.', 'approved');
select is(public.sync_whatsapp_message_templates(:ns, '771001',
  '[{"id": "1001", "name": "monthly_statement_v1", "language": "en", "category": "UTILITY", "status": "PAUSED"}]'::jsonb), 1,
  'a later sync replaces the catalogue');
select is((select count(*) from public.whatsapp_message_templates where company_id = :ns and business_account_id = '771001'), 1::bigint,
  'templates Meta no longer reports are removed');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'),
  'rejected', 'a paused template is no longer approved for sending');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'overdue_reminder_v1'),
  'draft', 'an approved template Meta no longer holds in any account goes back to draft, so the outbound gate stops sending it');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'initial_reminder_v1'),
  'draft', 'and so does a submitted one');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement' and language = 'en_ZA'),
  'approved', 'a template another account of the company still holds is not downgraded by this account''s sync');
select throws_ok($$select public.sync_whatsapp_message_templates('20000000-0000-4000-8000-000000000001', '771001', '{}'::jsonb)$$, '22023', null,
  'templates must be an array');

-- ================================================================== members read their own company only
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_number_verification_steps where number_id = (select id from tests.num)), 5::bigint,
  'a read-only member reads the company''s verification steps');
select is((select count(*) from public.whatsapp_message_templates where company_id = :kp), 0::bigint,
  'no member reads another company''s templates');
select throws_ok(format('select * from public.disconnect_whatsapp_number(%L, %L)', :ns, (select id from tests.num)), '42501', null,
  'a read-only member cannot disconnect');
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select throws_ok(format('select * from public.disconnect_whatsapp_number(%L, %L)', :ns, (select id from tests.num)), '42501', null,
  'a property manager cannot disconnect');
select is((select count(*) from public.whatsapp_message_templates where company_id = :kp), 1::bigint,
  'a member of both companies reads each company''s templates');

-- ================================================================== disconnect
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns,
             (select id from public.whatsapp_phone_numbers where phone_number_id = '660009'))),
  row('not_found', false)::text, 'another company''s number is not found under the admin''s own company');
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, (select id from tests.num))),
  row('disconnected', true)::text, 'the admin disconnects the number and its token is removed');
select is((select row(connection_status, webhook_configured)::text from public.whatsapp_phone_numbers where id = (select id from tests.num)),
  row('disconnected'::public.whatsapp_connection_status, false)::text, 'the number is marked disconnected');
reset role;
select is((select count(*) from vault.secrets where id = (select id from tests.secret)), 0::bigint, 'the vault secret is deleted');
select ok((select access_token_reference is null from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771001')
          and (select starts_with(access_token_reference, 'secret://env/') from public.whatsapp_phone_numbers where id = (select id from tests.num)),
  'neither the account nor the number references it any more');
select is(public.finish_whatsapp_number_verification(:ns, (select id from tests.num)), 'disconnected'::public.whatsapp_connection_status,
  'a verification finishing after a disconnect never reconnects the number');

-- ------------------------------------------------------------------ disconnect follows the token, not the account
create function tests.secret(p_label text) returns uuid language sql set search_path = '' as $$
  select vault.create_secret('EAAG-token-' || p_label || '-0123456789abcdef', 'whatsapp_access_token:20000000-0000-4000-8000-000000000001:onboarding:' || p_label)
$$;
create table tests.tokens as select l as label, tests.secret(l) as id from unnest('{a,b1,b2,c}'::text[]) l;
create function tests.ref(p_label text) returns text language sql set search_path = '' as $$
  select 'secret://vault/' || id::text from tests.tokens where label = p_label
$$;
create function tests.number_id(p_phone text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001' and phone_number_id = p_phone
$$;
grant execute on function tests.number_id(text) to authenticated;

-- A: a signup adds a second number to waba-ns, whose connected fixture number phone-ns uses the env token.
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference, connection_status)
values (:ns, 'waba-ns', '660101', '', '', tests.ref('a'), 'pending_verification');
update public.whatsapp_business_accounts set access_token_reference = tests.ref('a') where company_id = :ns and business_account_id = 'waba-ns';
-- B: two signups into one account: N1 on b1 (connected), N2 on b2, the account on b2 (the later signup).
insert into public.whatsapp_business_accounts (company_id, business_account_id, access_token_reference) values (:ns, '771002', tests.ref('b2'));
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference, connection_status)
values (:ns, '771002', '660201', '', '', tests.ref('b1'), 'connected'),
       (:ns, '771002', '660202', '', '', tests.ref('b2'), 'pending_verification');
-- C: two numbers of one account on the same token.
insert into public.whatsapp_business_accounts (company_id, business_account_id, access_token_reference) values (:ns, '771003', tests.ref('c'));
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference, connection_status)
values (:ns, '771003', '660301', '', '', tests.ref('c'), 'connected'),
       (:ns, '771003', '660302', '', '', tests.ref('c'), 'connected');

set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_id('660101'))),
  row('disconnected', true)::text, 'A: a number whose account neighbour uses another (env) token has its own token removed');
reset role;
select is((select count(*) from vault.secrets where id = (select id from tests.tokens where label = 'a')), 0::bigint,
  'A: its vault secret is deleted');
select ok((select access_token_reference is null from public.whatsapp_business_accounts where company_id = :ns and business_account_id = 'waba-ns')
          and (select connection_status = 'connected' and starts_with(access_token_reference, 'secret://env/')
               from public.whatsapp_phone_numbers where id = tests.number_id('phone-ns')),
  'A: the account no longer references it, and the neighbour keeps its env token and stays connected');

set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_id('660202'))),
  row('disconnected', true)::text, 'B: disconnecting the later signup''s number removes its token although N1 still uses the account');
reset role;
select is((select array_agg(label order by label) from tests.tokens t where exists (select 1 from vault.secrets s where s.id = t.id) and label like 'b%'),
  array['b1'], 'B: only the later token is deleted; N1''s token is kept');
select is((select access_token_reference from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771002'), null,
  'B: the account no longer references the deleted token');
set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_id('660201'))),
  row('disconnected', true)::text, 'B: disconnecting N1 later removes its token too');
reset role;
select is((select count(*) from vault.secrets where id = (select id from tests.tokens where label = 'b1')), 0::bigint,
  'B: no token of the account is left behind in Vault');

set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_id('660301'))),
  row('disconnected', false)::text, 'C: a token another number in use still holds is kept');
reset role;
select ok((select count(*) = 1 from vault.secrets where id = (select id from tests.tokens where label = 'c'))
          and (select access_token_reference = tests.ref('c') from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771003'),
  'C: the secret and the account''s reference stay for the other number');
set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_id('660302'))),
  row('disconnected', true)::text, 'C: disconnecting the last number on the token removes it');
reset role;
select is((select count(*) from vault.secrets where id = (select id from tests.tokens where label = 'c')), 0::bigint,
  'C: and its vault secret is deleted');

select * from finish();
rollback;
