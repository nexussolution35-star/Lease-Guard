-- WhatsApp Business Accounts and business numbers per company
-- (20261110100400_whatsapp_business_accounts_and_numbers): several accounts and numbers per company,
-- isolated by company; the credential reference is never readable by signed-in users; Meta status
-- fields are written by the service role only.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(37);

create schema tests;
grant usage on schema tests to authenticated, anon;
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

-- ================================================================== shape
select has_table('public', 'whatsapp_business_accounts', 'WhatsApp Business Accounts have their own table');
select has_table('public', 'whatsapp_phone_numbers', 'business numbers live in whatsapp_phone_numbers');
select hasnt_table('public', 'whatsapp_accounts', 'the one-account-per-company table is gone');
select is(
  (select count(*) from public.whatsapp_phone_numbers n
   where not exists (select 1 from public.whatsapp_business_accounts a
                     where a.company_id = n.company_id and a.business_account_id = n.business_account_id)),
  0::bigint, 'every number belongs to a business account of its own company');

-- ================================================================== several accounts and numbers
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000001', 'waba-ns', 'phone-ns-b', 'Nexus Leasing', '+27 11 555 0101'),
           ('20000000-0000-4000-8000-000000000001', 'waba-ns-2', 'phone-ns-c', 'Nexus Collections', '+27 11 555 0102')$$,
  'a company admin can add further numbers, under the same or another business account');
reset role;
select is(tests.owner_count('whatsapp_phone_numbers', '20000000-0000-4000-8000-000000000001'), 3::bigint,
  'the company now holds three numbers');
select is(tests.owner_count('whatsapp_business_accounts', '20000000-0000-4000-8000-000000000001'), 2::bigint,
  'the new business account was recorded for the company');
select is(
  (select row(connection_status, webhook_configured, access_token_reference)::text from public.whatsapp_phone_numbers
   where phone_number_id = 'phone-ns-c'),
  row('pending_verification'::public.whatsapp_connection_status, false,
      'secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001')::text,
  'an added number starts pending verification');
set local role authenticated;
select throws_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000001', 'waba-ns', 'phone-ns-b', 'Again', '+27 11 555 0101')$$,
  '23505', null, 'a company cannot hold the same number twice');

-- ================================================================== isolation
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is((select count(*) from public.whatsapp_business_accounts where company_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'a member of another company sees none of its business accounts');
select is((select count(*) from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'a member of another company sees none of its numbers');
select is((select array_agg(business_account_id) from public.whatsapp_business_accounts), array['waba-kp'],
  'a member sees only their own company''s business accounts');
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.whatsapp_phone_numbers), 3::bigint, 'a read-only member sees the company''s numbers');
select is((select count(*) from public.whatsapp_business_accounts where company_id = '20000000-0000-4000-8000-000000000002'), 0::bigint,
  'and none of another company''s accounts');
select throws_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000001', 'waba-ro', 'phone-ro', 'RO', '+27 11 555 0109')$$,
  '42501', null, 'a read-only member cannot add a number');
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select throws_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000002', 'waba-intruder', 'phone-intruder', 'X', '+27 11 555 0108')$$,
  '42501', null, 'an admin cannot add a number to another company');
reset role;
select is(
  (select count(*) from public.whatsapp_business_accounts where business_account_id in ('waba-ro', 'waba-intruder')),
  0::bigint, 'a refused number leaves no business account behind');

-- ================================================================== who writes what
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$insert into public.whatsapp_business_accounts (company_id, business_account_id) values ('20000000-0000-4000-8000-000000000001', 'waba-direct')$$,
  '42501', null, 'signed-in users cannot create business accounts directly');
select throws_ok(
  $$update public.whatsapp_business_accounts set name = 'Renamed' where company_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'signed-in users cannot change business accounts');
select throws_ok(
  $$update public.whatsapp_phone_numbers set quality_rating = 'GREEN' where phone_number_id = 'phone-ns-b'$$,
  '42501', null, 'Meta status fields are recorded by the service role only');
select throws_ok(
  $$select access_token_reference from public.whatsapp_phone_numbers$$,
  '42501', null, 'signed-in users cannot read the credential reference');
select lives_ok(
  $$select id, company_id, business_account_id, phone_number_id, display_name, display_number, verified_name, quality_rating,
           code_verification_status, name_status, meta_status, webhook_configured, connection_status, last_verified_at,
           created_at, updated_at
    from public.whatsapp_phone_numbers$$,
  'every other number column is readable by members');
reset role;

set local role service_role;
select lives_ok(
  $$update public.whatsapp_phone_numbers set verified_name = 'Nexus Leasing', quality_rating = 'GREEN', code_verification_status = 'VERIFIED',
      name_status = 'APPROVED', meta_status = 'CONNECTED', connection_status = 'connected'
    where phone_number_id = 'phone-ns-b'$$,
  'the service role records Meta''s status of a number');
select lives_ok(
  $$update public.whatsapp_business_accounts set name = 'Nexus Solution WABA' where business_account_id = 'waba-ns'$$,
  'the service role records a business account''s name');
reset role;
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set phone_number_id = 'phone-ns-d' where phone_number_id = 'phone-ns-b'$$,
  'an admin can still change a number''s Meta identifiers');
reset role;
select is(
  (select row(connection_status::text, verified_name, quality_rating, code_verification_status, name_status, meta_status)::text
   from public.whatsapp_phone_numbers where phone_number_id = 'phone-ns-d'),
  row('pending_verification', null::text, null::text, null::text, null::text, null::text)::text,
  'new identifiers drop the verified status Meta reported for the old number');

-- ================================================================== correcting a business account id
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set business_account_id = 'waba-ns-3' where phone_number_id = 'phone-ns-c'$$,
  'an admin can correct a number''s business account id');
reset role;
select is(
  (select array_agg(business_account_id order by business_account_id) from public.whatsapp_business_accounts
   where company_id = '20000000-0000-4000-8000-000000000001'),
  array['waba-ns', 'waba-ns-3'],
  'the corrected account is recorded and the account the admin emptied is removed');
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set business_account_id = 'waba-ns-4' where phone_number_id = 'phone-ns-d'$$,
  'an admin can move one number of an account that has others');
reset role;
select ok(
  exists (select 1 from public.whatsapp_business_accounts
          where company_id = '20000000-0000-4000-8000-000000000001' and business_account_id = 'waba-ns'),
  'an account that still has numbers is kept');
set local role service_role;
select lives_ok(
  $$update public.whatsapp_phone_numbers set business_account_id = 'waba-ns' where phone_number_id = 'phone-ns-c'$$,
  'the service role can move a number between accounts');
reset role;
select ok(
  exists (select 1 from public.whatsapp_business_accounts
          where company_id = '20000000-0000-4000-8000-000000000001' and business_account_id = 'waba-ns-3'),
  'the service role''s edits never remove accounts (it manages them itself)');
select is(
  (select proconfig from pg_proc where oid = 'private.remove_emptied_whatsapp_business_account'::regproc),
  array['search_path=""'], 'the clean-up trigger runs with an empty search_path');

-- ================================================================== integrity
select throws_ok(
  $$delete from public.whatsapp_business_accounts where business_account_id = 'waba-ns'$$,
  '23503', null, 'a business account with numbers cannot be deleted');
set local role anon;
select throws_ok($$select count(*) from public.whatsapp_business_accounts$$, '42501', null, 'anon cannot read business accounts');
select throws_ok($$select count(*) from public.whatsapp_phone_numbers$$, '42501', null, 'anon cannot read numbers');
reset role;
select is(
  (select array_agg(relname::text order by relname) from pg_class
   where relnamespace = 'public'::regnamespace and relname in ('whatsapp_business_accounts', 'whatsapp_phone_numbers') and relrowsecurity),
  array['whatsapp_business_accounts', 'whatsapp_phone_numbers'], 'both tables have Row Level Security enabled');

select * from finish();
rollback;
