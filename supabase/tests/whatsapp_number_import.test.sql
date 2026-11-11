-- Number import (20261111100500_whatsapp_number_import, ticket 15): a Nexus operator connects Nexus Solution's own
-- WhatsApp test number to one named company before Meta approves LeaseGuard's app. import_whatsapp_number (service
-- role only) plans the import (dry run) or applies it: the token goes into Vault for that company only, the account and
-- the number are recorded pending verification and stamped as imported. It refuses an unknown or inactive company and a
-- number or account another company holds; re-running never duplicates accounts, numbers or secrets, and a newer token
-- replaces the stored one. A later WhatsApp signup of the number clears the stamp and the import's secret.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(62);

create schema tests;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create table tests.results (label text primary key, outcome text, applied boolean, number_id uuid);
grant usage on schema tests to authenticated, service_role;
grant all on tests.results to authenticated, service_role;
-- The number an import recorded.
create function tests.number_of(p_label text) returns uuid
language sql security definer set search_path = '' as $$ select number_id from tests.results where label = p_label $$;
grant execute on function tests.number_of(text) to authenticated, service_role;
-- The secrets of a company the import may have written (Vault is not readable by signed-in users).
create function tests.import_secrets(p_company_id uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from vault.secrets s where starts_with(s.name, 'whatsapp_access_token:' || p_company_id::text || ':import:')
$$;
create function tests.token_of(p_number_id uuid) returns text
language sql security definer set search_path = '' as $$ select public.whatsapp_account_access_token(p_number_id) $$;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''
\set token '\'EAAG-nexus-test-number-token-0123456789\''
\set newer '\'EAAG-nexus-test-number-token-newer-9876543210\''

-- An archived company, and numbers of KP for the refusals: one connected, one waiting for verification with a token
-- Meta granted through WhatsApp signup, one merely typed by an admin (env reference, never verified).
insert into public.companies (id, name, address_line1, suburb, city, province, postal_code, contact_email, contact_phone, initials, status)
values ('20000000-0000-4000-8000-000000000003', 'Closed Properties', '9 Main Road', 'Sandton', 'Johannesburg', 'Gauteng', '2196',
        'info@closed.co.za', '+27 11 555 0300', 'CP', 'archived');
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, connection_status, last_verified_at)
values (:kp, '771200', '661200', 'KP connected', '+27 12 555 0201', 'connected', now()),
       (:kp, '771300', '661300', 'KP typed', '+27 12 555 0203', 'pending_verification', null);
with secret as (select vault.create_secret('EAAG-kp-signup-token-0123456789', 'whatsapp_access_token:' || :kp || ':onboarding:fixture') as id)
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference, connection_status)
select :kp, '771400', '661400', '', '', 'secret://vault/' || id::text, 'pending_verification' from secret;
update public.whatsapp_business_accounts set access_token_reference = n.access_token_reference
from public.whatsapp_phone_numbers n
where n.phone_number_id = '661400' and whatsapp_business_accounts.company_id = n.company_id
  and whatsapp_business_accounts.business_account_id = n.business_account_id;

-- ================================================================== shape and privileges
select is((select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p
           where p.oid = 'public.import_whatsapp_number(uuid, text, text, text, boolean)'::regprocedure and p.prosecdef),
  'search_path=""', 'the import is SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('anon', 'public.import_whatsapp_number(uuid, text, text, text, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_whatsapp_number(uuid, text, text, text, boolean)', 'execute'),
  'anon and signed-in users cannot import a number');
select ok(has_function_privilege('service_role', 'public.import_whatsapp_number(uuid, text, text, text, boolean)', 'execute'),
  'the operator command (service role) imports');
select ok(has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'operator_imported_at', 'select')
          and not has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'operator_imported_at', 'update')
          and not has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'operator_imported_at', 'insert'),
  'members read when a number was imported, but never write it');

-- ================================================================== input
set local role service_role;
select throws_ok(format('select * from public.import_whatsapp_number(%L, %L, %L, %L)', :ns, 'waba-ns', '661100', :token), '22023', null,
  'the WhatsApp Business Account id must be Meta''s numeric id');
select throws_ok(format('select * from public.import_whatsapp_number(%L, %L, %L, %L)', :ns, '771100', 'phone 1', :token), '22023', null,
  'the phone number id must be Meta''s numeric id');
select throws_ok(format('select * from public.import_whatsapp_number(%L, %L, %L, %L)', :ns, '771100', '661100', 'too-short'), '22023', null,
  'a token that is too short is refused');
select throws_ok(format('select * from public.import_whatsapp_number(%L, %L, %L, %L)', :ns, '771100', '661100', 'EAAG token with spaces 0123456789'), '22023', null,
  'a token with whitespace is refused');

-- ================================================================== refusals
select is((select outcome from public.import_whatsapp_number('20000000-0000-4000-8000-0000000000ff', '771100', '661100', :token)),
  'company_not_found', 'an unknown company is refused');
select is((select row(outcome, company_name)::text from public.import_whatsapp_number('20000000-0000-4000-8000-000000000003', '771100', '661100', :token)),
  row('company_not_active', 'Closed Properties')::text, 'an archived company is refused');
select is((select row(outcome, conflicting_company_id, conflicting_company_name)::text from public.import_whatsapp_number(:ns, '771200', '661200', :token)),
  row('number_in_use', :kp::uuid, 'Kgalagadi Property Holdings')::text, 'a number another company has connected is refused, naming it');
select is((select outcome from public.import_whatsapp_number(:ns, '771400', '661400', :token, true)),
  'number_in_use', 'a number another company holds with a token Meta granted (waiting for verification) is refused, even when applying');
select is((select outcome from public.import_whatsapp_number(:ns, '771400', '661401', :token, true)),
  'account_in_use', 'a number of a WhatsApp Business Account another company holds is refused');
select is((select outcome from public.import_whatsapp_number(:ns, '771300', '661300', :token)),
  'new_number', 'a number another company only typed (never verified, no token) does not belong to it');
reset role;
select is((select count(*) from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id in ('661200', '661400', '661401', '661300')),
  0::bigint, 'nothing was recorded for the refused imports or the dry run');
select is(tests.import_secrets(:ns), 0::bigint, 'no token was stored by them');

-- ================================================================== dry run
set local role service_role;
select is((select row(outcome, applied, company_name, number_id, previous_status)::text
           from public.import_whatsapp_number(:ns, '771100', '661100', :token)),
  row('new_number', false, 'Nexus Solution', null::uuid, null::public.whatsapp_connection_status)::text,
  'a dry run (the default) says what it would do');
reset role;
select is((select count(*) from public.whatsapp_phone_numbers where phone_number_id = '661100'), 0::bigint, 'and writes no number');
select is((select count(*) from public.whatsapp_business_accounts where business_account_id = '771100'), 0::bigint, 'and no account');
select is(tests.import_secrets(:ns), 0::bigint, 'and stores no token');

-- ================================================================== apply
set local role service_role;
insert into tests.results (label, outcome, applied, number_id)
  select 'imported', outcome, applied, number_id from public.import_whatsapp_number(:ns, '771100', '661100', :token, true);
reset role;
select is((select row(outcome, applied, number_id is not null)::text from tests.results where label = 'imported'), row('new_number', true, true)::text,
  'applying records the number');
select is((select row(connection_status, webhook_configured, operator_imported_at is not null, starts_with(access_token_reference, 'secret://vault/'))::text
           from public.whatsapp_phone_numbers where id = tests.number_of('imported')),
  row('pending_verification', false, true, true)::text, 'pending verification, stamped as imported, its token in Vault');
select is(tests.token_of(tests.number_of('imported')), :token, 'the worker reads the token for this number of this company');
select is(tests.import_secrets(:ns), 1::bigint, 'one secret, named for the company');
select is((select access_token_reference from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771100'),
  (select access_token_reference from public.whatsapp_phone_numbers where id = tests.number_of('imported')),
  'the account references the same token');
select is((select array_agg(company_id) from public.whatsapp_business_account_holders('771100')), array[:ns::uuid],
  'the company holds the account (account events apply to it)');
select is((select count(*) from vault.secrets where name like '%' || :kp || '%import%'), 0::bigint, 'nothing was stored for another company');

-- ================================================================== re-running
set local role service_role;
select is((select row(outcome, applied, number_id, previous_status)::text from public.import_whatsapp_number(:ns, '771100', '661100', :token, true)),
  row('token_unchanged', true, tests.number_of('imported'), 'pending_verification'::public.whatsapp_connection_status)::text,
  're-running with the same token keeps it and verifies again');
reset role;
select is((select count(*) from public.whatsapp_phone_numbers where phone_number_id = '661100'), 1::bigint, 'no duplicate number');
select is((select count(*) from public.whatsapp_business_accounts where business_account_id = '771100'), 1::bigint, 'no duplicate account');
select is(tests.import_secrets(:ns), 1::bigint, 'no duplicate secret');

-- Verification connected the number (the worker's decision).
update public.whatsapp_phone_numbers set connection_status = 'connected', webhook_configured = true, last_verified_at = now()
where id = tests.number_of('imported');
set local role service_role;
select is((select row(outcome, applied)::text from public.import_whatsapp_number(:ns, '771100', '661100', :token, true)),
  row('already_connected', true)::text, 'a connected number with the same token and account is left alone');
reset role;
select is((select connection_status::text from public.whatsapp_phone_numbers where id = tests.number_of('imported')), 'connected',
  'and stays connected (no needless verification)');

create temporary table first_reference on commit drop as
  select access_token_reference as reference from public.whatsapp_phone_numbers where id = tests.number_of('imported');
set local role service_role;
select is((select row(outcome, previous_status, secrets_deleted)::text from public.import_whatsapp_number(:ns, '771100', '661100', :newer, true)),
  row('token_stored', 'connected'::public.whatsapp_connection_status, 1)::text, 'a newer token replaces the stored one');
reset role;
select is(tests.token_of(tests.number_of('imported')), :newer, 'the worker now reads the newer token');
select is(tests.import_secrets(:ns), 1::bigint, 'the earlier token was deleted from Vault');
select ok((select access_token_reference <> (select reference from first_reference) from public.whatsapp_phone_numbers where id = tests.number_of('imported')),
  'a newer token is a new secret (a newer grant than any earlier Meta event)');
select is((select connection_status::text from public.whatsapp_phone_numbers where id = tests.number_of('imported')), 'pending_verification',
  'the number is verified again with the newer token before it is connected');

-- An operator who mistyped the account id corrects it: the number moves, the emptied account is removed.
set local role service_role;
select is((select outcome from public.import_whatsapp_number(:ns, '771101', '661100', :newer, true)), 'token_unchanged',
  'the same token with a corrected account id');
reset role;
select is((select business_account_id from public.whatsapp_phone_numbers where id = tests.number_of('imported')), '771101',
  'the number moved to the corrected account');
select is((select count(*) from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771100'), 0::bigint,
  'the account it left empty is removed');
select is((select count(*) from public.whatsapp_business_accounts where company_id = :ns and business_account_id = '771101' and access_token_reference is not null),
  1::bigint, 'the corrected account references the token');
select is(tests.import_secrets(:ns), 1::bigint, 'still one secret');

-- ================================================================== an existing number of the company
-- A number an admin added by its Meta ids (env reference, pending): importing stores a Vault token for it.
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, connection_status)
values (:ns, '771500', '661500', 'Typed by the admin', '+27 11 555 0105', 'pending_verification');
set local role service_role;
select is((select row(outcome, previous_status)::text from public.import_whatsapp_number(:ns, '771500', '661500', :token, true)),
  row('token_stored', 'pending_verification'::public.whatsapp_connection_status)::text, 'a number the company already lists gets the imported token');
reset role;
select is((select count(*) from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = '661500' and starts_with(access_token_reference, 'secret://vault/')),
  1::bigint, 'the same row, now on a Vault token');
select is(tests.import_secrets(:ns), 2::bigint, 'each imported number has its own secret');

-- ================================================================== disconnect, and a later WhatsApp signup
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select is((select row(outcome, token_removed)::text from public.disconnect_whatsapp_number(:ns, tests.number_of('imported'))),
  row('disconnected', true)::text, 'an admin disconnects the imported number; its token is deleted');
select ok((select operator_imported_at is not null from public.whatsapp_phone_numbers where id = tests.number_of('imported')),
  'the admin still sees that it was imported (so it is imported again, not signed up)');
reset role;
set local role service_role;
select is((select row(outcome, previous_status)::text from public.import_whatsapp_number(:ns, '771101', '661100', :token, true)),
  row('token_stored', 'disconnected'::public.whatsapp_connection_status)::text, 'importing a disconnected number connects it again');
reset role;
select is((select connection_status::text from public.whatsapp_phone_numbers where id = tests.number_of('imported')), 'pending_verification',
  'pending verification again');

-- After Meta's approval the admin connects the same number through WhatsApp signup.
insert into public.whatsapp_onboarding_sessions (company_id, started_by, state_hash, status, event, embedded_signup_version, messaging_account_ids, phone_number_id, code_received_at)
values (:ns, '10000000-0000-4000-8000-000000000001', repeat('c', 64), 'code_received', 'FINISH', 'v5', '{771101}', '661100', now());
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(format('select * from public.store_whatsapp_onboarding_token(%L, %L, %L)', :ns,
  (select id from public.whatsapp_onboarding_sessions where company_id = :ns and status = 'code_received'), 'EAAG-signup-token-for-the-same-number-01'),
  'the signup stores its own token for the number');
select ok((select operator_imported_at is null from public.whatsapp_phone_numbers where id = tests.number_of('imported')),
  'the number is no longer marked as imported');
reset role;
select is(tests.token_of(tests.number_of('imported')), 'EAAG-signup-token-for-the-same-number-01', 'the worker reads the signup''s token');
select is(tests.import_secrets(:ns), 1::bigint, 'the import''s secret the signup replaced was deleted (the second number keeps its own)');

-- ================================================================== Meta removes access to an imported number
-- The import's token makes the company the account holder, so Meta's removal events disconnect an imported number
-- (remove_whatsapp_business_account_access, 20261110101000). Its admins are told to have it imported again, like the
-- integration page and the verification steps, never to use Connect WhatsApp Business.
set local role service_role;
select is((select array_agg(row(company_id, numbers_disconnected, token_removed, admins_notified)::text)
           from public.remove_whatsapp_business_account_access('771500', 'ACCOUNT_DELETED', now())),
  array[row(:ns::uuid, 1, true, 1)::text], 'Meta deleting the account of an imported number disconnects it, deletes the import''s token and notifies the admin');
reset role;
select ok((select operator_imported_at is not null from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = '661500'),
  'the disconnected number is still marked as imported');
select is((select body from public.notifications where company_id = :ns and dedupe_key like 'whatsapp-access-removed:' || md5('771500') || ':%'),
  'Meta reported that this WhatsApp Business Account was deleted. LeaseGuard disconnected 1 number of WhatsApp Business Account 771500 '
    || 'and deleted its stored access token. WhatsApp messages cannot be sent or received on it until it is imported again: '
    || 'ask Nexus Solution to import it again with the number import.',
  'the admin is told to ask Nexus Solution to import the number again, not to use Connect WhatsApp Business');

-- An account with an imported number and a number that was not imported: each is connected again its own way.
set local role service_role;
select is((select outcome from public.import_whatsapp_number(:ns, '771600', '661600', :token, true)), 'new_number',
  'another number is imported');
reset role;
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, connection_status, last_verified_at)
values (:ns, '771600', '661601', 'Signed up', '+27 11 555 0106', 'connected', now());
set local role service_role;
select is((select array_agg(row(company_id, numbers_disconnected, token_removed, admins_notified)::text)
           from public.remove_whatsapp_business_account_access('771600', 'ACCOUNT_OFFBOARDED', now())),
  array[row(:ns::uuid, 2, true, 1)::text], 'Meta offboarding the account disconnects both numbers');
reset role;
select is((select body from public.notifications where company_id = :ns and dedupe_key like 'whatsapp-access-removed:' || md5('771600') || ':%'),
  'Meta reported that this WhatsApp Business Account was offboarded. LeaseGuard disconnected 2 numbers of WhatsApp Business Account 771600 '
    || 'and deleted its stored access token. WhatsApp messages cannot be sent or received on them until they are connected again. '
    || 'Ask Nexus Solution to import the imported number again with the number import; a company admin connects the other number '
    || 'again with Connect WhatsApp Business on the WhatsApp integration page.',
  'the admin is told which number Nexus Solution imports again and which one is connected with Connect WhatsApp Business');

-- ================================================================== isolation
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_phone_numbers where company_id = :ns), 0::bigint,
  'members of another company never see the imported numbers');
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = '661500' and operator_imported_at is not null), 1::bigint,
  'members of the company see that a number was imported');
reset role;

select * from finish();
rollback;
