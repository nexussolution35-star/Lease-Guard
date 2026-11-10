-- Meta Embedded Signup onboarding sessions (20261110100600_whatsapp_onboarding_sessions): single-use,
-- expiring sessions owned by the company admin who started them; the business token goes into Vault for
-- that company only and is never readable by signed-in users; non-admins and other companies can neither
-- start nor complete a session.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(46);

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create table tests.started (label text primary key, session_id uuid, state text);
grant all on tests.started to authenticated;

-- A second NS admin and a KP admin (the fixture has no admin in KP).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'ayanda@nexussolution.co.za', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'admin@kgalagadiproperty.co.za', now(), '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102');
insert into public.company_users (company_id, user_id, role, is_default) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000101', 'company_admin', true),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000102', 'company_admin', true);

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''
\set token '\'EAAG-business-token-for-tests-0123456789\''

-- ================================================================== shape and privileges
select has_table('public', 'whatsapp_onboarding_sessions', 'onboarding sessions have their own table');
select ok(not has_table_privilege('authenticated', 'public.whatsapp_onboarding_sessions', 'insert, update, delete'),
  'signed-in users cannot write sessions directly');
select ok(not has_column_privilege('authenticated', 'public.whatsapp_onboarding_sessions', 'state_hash', 'select'),
  'signed-in users cannot read the state hash');
select ok(not has_column_privilege('authenticated', 'public.whatsapp_business_accounts', 'access_token_reference', 'select'),
  'signed-in users cannot read an account''s credential reference');
select ok(not has_function_privilege('anon', 'public.start_whatsapp_onboarding(uuid)', 'execute'), 'anon cannot start a session');
select ok(not has_function_privilege('anon', 'public.store_whatsapp_onboarding_token(uuid, uuid, text)', 'execute'), 'anon cannot store a token');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%whatsapp_onboarding%' and p.prosecdef
     and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'),
  array['fail_whatsapp_onboarding_exchange', 'record_whatsapp_onboarding_result', 'start_whatsapp_onboarding', 'store_whatsapp_onboarding_token'],
  'every onboarding function is SECURITY DEFINER with an empty search_path');

-- ================================================================== who may start
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$select * from public.start_whatsapp_onboarding('20000000-0000-4000-8000-000000000001')$$, '42501', null,
  'a property manager cannot start a signup');
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok($$select * from public.start_whatsapp_onboarding('20000000-0000-4000-8000-000000000001')$$, '42501', null,
  'a read-only member cannot start a signup');
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select throws_ok($$select * from public.start_whatsapp_onboarding('20000000-0000-4000-8000-000000000002')$$, '42501', null,
  'an admin of another company cannot start a signup for it');

insert into tests.started select 'first', session_id, state from public.start_whatsapp_onboarding(:ns);
insert into tests.started select 'main', session_id, state from public.start_whatsapp_onboarding(:ns);
select ok((select state ~ '^[0-9a-f]{64}$' from tests.started where label = 'main'), 'the state is 256 bits of hex');
select is((select status::text from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'first')),
  'expired', 'starting again expires the admin''s earlier open signup');
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'first'),
  (select state from tests.started where label = 'first'), 'code_received', 'FINISH', 'v5', null, array['771009'], null),
  'expired', 'finishing a signup a newer one superseded is reported as expired, not as already used');
select is((select count(*) from public.whatsapp_onboarding_sessions where status = 'started' and id in (select session_id from tests.started)), 1::bigint,
  'one open signup per admin and company');
select ok((select expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
           from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'main')),
  'a session expires after 15 minutes');

-- ================================================================== who may complete
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'main'), 'wrong-state', 'cancelled', 'CANCEL'),
  'not_found', 'a wrong state is not accepted');
select is(public.record_whatsapp_onboarding_result(:kp, (select session_id from tests.started where label = 'main'),
  (select state from tests.started where label = 'main'), 'cancelled', 'CANCEL'),
  'not_found', 'a session cannot be completed under another company');
select set_config('request.jwt.claims', tests.claims('ayanda@nexussolution.co.za'), true);
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'main'),
  (select state from tests.started where label = 'main'), 'cancelled', 'CANCEL'),
  'not_found', 'another admin of the same company cannot complete it');
select is((select count(*) from public.whatsapp_onboarding_sessions where id in (select session_id from tests.started)), 2::bigint,
  'admins read their company''s sessions');
select set_config('request.jwt.claims', tests.claims('admin@kgalagadiproperty.co.za'), true);
select is(public.record_whatsapp_onboarding_result(:kp, (select session_id from tests.started where label = 'main'),
  (select state from tests.started where label = 'main'), 'cancelled', 'CANCEL'),
  'not_found', 'an admin of another company cannot complete it');
select is((select count(*) from public.whatsapp_onboarding_sessions where company_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'an admin of another company sees none of its sessions');
select throws_ok(format('select * from public.store_whatsapp_onboarding_token(%L, %L, %L)', :kp,
  (select session_id from tests.started where label = 'main'), :token), 'P0002', null,
  'an admin of another company cannot store a token for it');
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.whatsapp_onboarding_sessions), 0::bigint, 'non-admin members do not read sessions');

-- ================================================================== happy path (v5: messaging account ids)
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select throws_ok(format('select * from public.store_whatsapp_onboarding_token(%L, %L, %L)', :ns,
  (select session_id from tests.started where label = 'main'), :token), '55000', null,
  'no token is stored before a code was received');
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'main'),
  (select state from tests.started where label = 'main'), 'code_received', 'FINISH', 'v5', '880011', array['771001', '771002'], '660001'),
  'recorded', 'the admin records a finished signup with a code');
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'main'),
  (select state from tests.started where label = 'main'), 'code_received', 'FINISH', 'v5', '880011', array['771001'], '660001'),
  'already_used', 'a session is single-use: the same result cannot be recorded twice');
select is(
  (select array_agg(row(business_account_id, phone_number_id)::text order by business_account_id)
   from public.store_whatsapp_onboarding_token(:ns, (select session_id from tests.started where label = 'main'), :token)),
  array[row('771001', '660001')::text, row('771002', null)::text],
  'storing the token returns the shared accounts and the number, never the token');
select throws_ok(format('select * from public.store_whatsapp_onboarding_token(%L, %L, %L)', :ns,
  (select session_id from tests.started where label = 'main'), :token), '55000', null,
  'a token is stored only once per session');
select is((select status::text from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'main')),
  'exchanged', 'the session is marked exchanged');
select is(
  (select row(connection_status, webhook_configured, business_account_id)::text from public.whatsapp_phone_numbers where phone_number_id = '660001'),
  row('pending_verification'::public.whatsapp_connection_status, false, '771001')::text,
  'the new number is pending verification under the first shared account');
select throws_ok($$select access_token_reference from public.whatsapp_phone_numbers where phone_number_id = '660001'$$, '42501', null,
  'the admin cannot read the number''s credential reference');
reset role;

select is(
  (select s.decrypted_secret from public.whatsapp_phone_numbers n
   join vault.decrypted_secrets s on n.access_token_reference = 'secret://vault/' || s.id::text where n.phone_number_id = '660001'),
  'EAAG-business-token-for-tests-0123456789', 'the number points at the business token in Vault');
select ok(
  (select starts_with(s.name, 'whatsapp_access_token:20000000-0000-4000-8000-000000000001:') from public.whatsapp_phone_numbers n
   join vault.secrets s on n.access_token_reference = 'secret://vault/' || s.id::text where n.phone_number_id = '660001'),
  'the vault secret is named for the company');
select is(
  public.whatsapp_account_access_token((select id from public.whatsapp_phone_numbers where phone_number_id = '660001')),
  'EAAG-business-token-for-tests-0123456789', 'the worker''s token lookup resolves the number''s token');
select is(
  (select count(distinct access_token_reference) from public.whatsapp_business_accounts where business_account_id in ('771001', '771002')),
  1::bigint, 'both shared accounts reference the same business token');

-- ================================================================== reconnecting replaces the token
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
insert into tests.started select 'again', session_id, state from public.start_whatsapp_onboarding(:ns);
select public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'again'),
  (select state from tests.started where label = 'again'), 'code_received', 'FINISH', 'v4', null, array['771001'], '660001');
select * from public.store_whatsapp_onboarding_token(:ns, (select session_id from tests.started where label = 'again'), 'EAAG-second-business-token-0123456789');
reset role;
select is(
  (select count(*) from vault.secrets where name like 'whatsapp_access_token:20000000-0000-4000-8000-000000000001:onboarding:%'),
  2::bigint, 'the first token stays while account 771002 still uses it');
select is(
  public.whatsapp_account_access_token((select id from public.whatsapp_phone_numbers where phone_number_id = '660001')),
  'EAAG-second-business-token-0123456789', 'the number now uses the newer token');

-- ================================================================== a number moving to the first shared account
-- 660009 was first recorded under account 990001. Meta now shares 771005 and 990001, so the number moves to
-- 771005; that empties 990001, which the admin-edit cleanup trigger would delete, yet Meta shared it.
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number,
  connection_status, webhook_configured)
values ('20000000-0000-4000-8000-000000000001', '990001', '660009', 'Moved', '+27 11 000 0009', 'pending_verification', false);
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
insert into tests.started select 'move', session_id, state from public.start_whatsapp_onboarding(:ns);
select public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'move'),
  (select state from tests.started where label = 'move'), 'code_received', 'FINISH', 'v5', null, array['771005', '990001'], '660009');
select is(
  (select array_agg(business_account_id order by business_account_id)
   from public.store_whatsapp_onboarding_token(:ns, (select session_id from tests.started where label = 'move'), 'EAAG-third-business-token-0123456789')),
  array['771005', '990001'], 'storing the token reports both shared accounts');
reset role;
select is(
  (select business_account_id from public.whatsapp_phone_numbers where phone_number_id = '660009'),
  '771005', 'the number moves to the first shared account');
select is(
  (select array_agg(a.business_account_id order by a.business_account_id) from public.whatsapp_business_accounts a
   join public.whatsapp_phone_numbers n on n.company_id = a.company_id and n.access_token_reference = a.access_token_reference
   where n.phone_number_id = '660009'),
  array['771005', '990001'], 'every account Meta shared is still recorded, with the new business token');

-- ================================================================== cancel, error, expiry
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
insert into tests.started select 'cancel', session_id, state from public.start_whatsapp_onboarding(:ns);
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'cancel'),
  (select state from tests.started where label = 'cancel'), 'cancelled', 'CANCEL', p_current_step => 'PHONE_NUMBER_SETUP',
  p_error_message => 'You closed the signup.'), 'recorded', 'a cancelled signup is recorded');
select is((select row(status, current_step)::text from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'cancel')),
  row('cancelled'::public.whatsapp_onboarding_status, 'PHONE_NUMBER_SETUP')::text, 'with the step the admin left at');

insert into tests.started select 'exchange', session_id, state from public.start_whatsapp_onboarding(:ns);
select public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'exchange'),
  (select state from tests.started where label = 'exchange'), 'code_received', 'FINISH', 'v5', null, array['771003'], null);
select is(public.fail_whatsapp_onboarding_exchange(:ns, (select session_id from tests.started where label = 'exchange'), 'Meta refused the code.'),
  'recorded', 'a failed code exchange is recorded');
select is((select status::text from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'exchange')),
  'failed', 'and the session is failed');

insert into tests.started select 'late', session_id, state from public.start_whatsapp_onboarding(:ns);
reset role;
update public.whatsapp_onboarding_sessions set expires_at = now() - interval '1 second'
where id = (select session_id from tests.started where label = 'late');
set local role authenticated;
select is(public.record_whatsapp_onboarding_result(:ns, (select session_id from tests.started where label = 'late'),
  (select state from tests.started where label = 'late'), 'code_received', 'FINISH', 'v5', null, array['771004'], null),
  'expired', 'an expired session cannot be completed');
select is((select status::text from public.whatsapp_onboarding_sessions where id = (select session_id from tests.started where label = 'late')),
  'expired', 'and it is marked expired');
reset role;

select * from finish();
rollback;
