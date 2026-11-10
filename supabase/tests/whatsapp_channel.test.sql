-- WhatsApp channel database contract: access-token reference forms and the vault lookup
-- (20261110100000_whatsapp_vault_token_references) and one verified company per receiving number
-- (20261110100100_whatsapp_receiving_number_unique).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(27);

create schema tests;
grant usage on schema tests to authenticated, service_role, anon;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create table tests.ids as select
  (select id from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001') as ns_account,
  (select id from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000002') as kp_account;
create table tests.secrets (name text primary key, id uuid not null);
insert into tests.secrets values
  ('ns', vault.create_secret('ns-token', 'whatsapp_access_token:20000000-0000-4000-8000-000000000001', '')),
  ('ns_waba', vault.create_secret('ns-waba-token', 'whatsapp_access_token:20000000-0000-4000-8000-000000000001:waba-ns', '')),
  ('kp', vault.create_secret('kp-token', 'whatsapp_access_token:20000000-0000-4000-8000-000000000002', '')),
  ('ns_lookalike', vault.create_secret('lookalike-token', 'whatsapp_access_token:20000000-0000-4000-8000-0000000000012', '')),
  ('unrelated', vault.create_secret('service-key', 'some_other_secret', ''));
grant select on tests.ids, tests.secrets to authenticated, service_role, anon;

-- Points an account at a reference as the database owner (like the service role).
create function tests.point(p_account uuid, p_reference text) returns void
language sql as $$
  update public.whatsapp_phone_numbers set access_token_reference = p_reference where id = p_account
$$;
create function tests.vault_ref(p_secret text) returns text
language sql as $$ select 'secret://vault/' || id from tests.secrets where name = p_secret $$;

-- ================================================================== reference parity
-- The TypeScript parser (backend/src/infrastructure/whatsapp/access-token-reference.test.ts) reads
-- the cases between the two marker lines below, so SQL and TypeScript are checked against one table.
-- Keep one case per line in the form ('<reference>', '<company id>', <accepted>).
create table tests.reference_cases (reference text, company_id uuid, accepted boolean);
-- reference-parity-cases:begin
insert into tests.reference_cases values
  ('secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001', '20000000-0000-4000-8000-000000000001', true),
  ('secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000002', '20000000-0000-4000-8000-000000000002', true),
  ('secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000002', '20000000-0000-4000-8000-000000000001', false),
  ('secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001 ', '20000000-0000-4000-8000-000000000001', false),
  ('secret://env/whatsapp_access_token_20000000000040008000000000000001', '20000000-0000-4000-8000-000000000001', false),
  ('secret://env/WHATSAPP_ACCESS_TOKEN', '20000000-0000-4000-8000-000000000001', false),
  ('secret://env/WHATSAPP_ACCESS_TOKEN_NEXUS', '20000000-0000-4000-8000-000000000001', false),
  ('secret://env/SUPABASE_SERVICE_ROLE_KEY', '20000000-0000-4000-8000-000000000001', false),
  ('WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13', '20000000-0000-4000-8000-000000000001', true),
  ('secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13', '20000000-0000-4000-8000-000000000002', true),
  ('secret://vault/3F0C1A52-8D4E-4B7A-9C61-2E5D7F9A0B13', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/3f0c1a528d4e4b7a9c612e5d7f9a0b13', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13/token', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/ 3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/whatsapp_access_token:20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', false),
  ('secret://vault/', '20000000-0000-4000-8000-000000000001', false),
  ('secret://whatsapp/cmp_nexus/access-token', '20000000-0000-4000-8000-000000000001', false),
  ('', '20000000-0000-4000-8000-000000000001', false);
-- reference-parity-cases:end

select is(
  (select array_agg(reference order by reference) from tests.reference_cases
   where private.is_whatsapp_token_reference(reference, company_id) is distinct from accepted),
  null, 'the reference rule accepts and rejects exactly the parity cases');

-- ================================================================== the CHECK and the trigger
select lives_ok(
  $$select tests.point((select ns_account from tests.ids), tests.vault_ref('ns'))$$,
  'the service role can point an account at a vault secret');
select is(
  (select access_token_reference from public.whatsapp_phone_numbers where id = (select ns_account from tests.ids)),
  tests.vault_ref('ns'), 'a vault reference is stored as given');
select throws_ok(
  $$select tests.point((select ns_account from tests.ids), 'secret://vault/not-a-uuid')$$,
  '23514', null, 'a malformed vault reference is refused by the CHECK');
select lives_ok(
  $$select tests.point((select ns_account from tests.ids), 'secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000002')$$,
  'an env reference to another company is accepted but rewritten');
select is(
  (select access_token_reference from public.whatsapp_phone_numbers where id = (select ns_account from tests.ids)),
  'secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001',
  'the env form is always the account''s own company''s variable');

-- A signed-in admin keeps the stored vault reference and still cannot set one.
select tests.point((select ns_account from tests.ids), tests.vault_ref('ns'));
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set display_name = 'Nexus Solution (Pty) Ltd' where id = (select ns_account from tests.ids)$$,
  'an admin can edit display details of a vault-backed account');
select throws_ok(
  $$update public.whatsapp_phone_numbers set access_token_reference = 'secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13'
    where id = (select ns_account from tests.ids)$$,
  '42501', null, 'an admin cannot point the account at a secret');
select lives_ok(
  $$update public.whatsapp_phone_numbers set phone_number_id = 'phone-ns-2' where id = (select ns_account from tests.ids)$$,
  'an admin can change the Meta identifiers');
reset role;
select is(
  (select row(access_token_reference, connection_status::text)::text from public.whatsapp_phone_numbers where id = (select ns_account from tests.ids)),
  row(tests.vault_ref('ns'), 'pending_verification')::text,
  'admin edits keep the vault reference; new identifiers need verifying again');

-- ================================================================== vault lookup
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), 'ns-token',
  'the service role resolves the account''s own vault secret');
reset role;
select tests.point((select ns_account from tests.ids), tests.vault_ref('ns_waba'));
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), 'ns-waba-token',
  'a secret named whatsapp_access_token:<company id>:<suffix> also belongs to the company');
reset role;

select tests.point((select ns_account from tests.ids), tests.vault_ref('kp'));
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), null,
  'another company''s secret is refused');
reset role;
select tests.point((select ns_account from tests.ids), tests.vault_ref('ns_lookalike'));
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), null,
  'a secret whose name only starts with the company id is refused');
reset role;
select tests.point((select ns_account from tests.ids), tests.vault_ref('unrelated'));
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), null,
  'a vault secret that is not a WhatsApp token is refused');
reset role;
select tests.point((select ns_account from tests.ids), 'secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13');
set local role service_role;
select is(public.whatsapp_account_access_token((select ns_account from tests.ids)), null,
  'a reference to a missing secret resolves to nothing');
-- KP still has its env reference: the vault lookup never reads a secret for it.
select is(public.whatsapp_account_access_token((select kp_account from tests.ids)), null,
  'an env reference resolves to nothing in the vault');
select is(public.whatsapp_account_access_token('00000000-0000-4000-8000-000000000000'), null,
  'an unknown account resolves to nothing');
reset role;

select tests.point((select ns_account from tests.ids), tests.vault_ref('ns'));
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$select public.whatsapp_account_access_token((select ns_account from tests.ids))$$,
  '42501', null, 'a signed-in company admin cannot read the token');
reset role;
set local role anon;
select throws_ok(
  $$select public.whatsapp_account_access_token((select ns_account from tests.ids))$$,
  '42501', null, 'anon cannot read the token');
reset role;
select is(
  array[has_function_privilege('public', 'public.whatsapp_account_access_token(uuid)', 'execute'),
        has_function_privilege('authenticated', 'public.whatsapp_account_access_token(uuid)', 'execute'),
        has_function_privilege('anon', 'public.whatsapp_account_access_token(uuid)', 'execute'),
        has_function_privilege('service_role', 'public.whatsapp_account_access_token(uuid)', 'execute')],
  array[false, false, false, true], 'only the service role may execute the vault lookup');

-- ================================================================== one company per receiving number
-- Ownership follows verification: an admin can type any phone_number_id (the row stays pending), but
-- only one connected account may hold a number, so a pending claim never blocks the real owner.
-- Make Thandi (Nexus admin) a Kgalagadi admin too, so one session can act for both companies.
insert into public.company_users (company_id, user_id, role, is_default)
  values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'company_admin', false);
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set phone_number_id = '109876543210987' where id = (select ns_account from tests.ids)$$,
  'an admin may enter any number; it stays an unverified claim');
select lives_ok(
  $$update public.whatsapp_phone_numbers set phone_number_id = '109876543210987' where id = (select kp_account from tests.ids)$$,
  'another company can still configure that number while the claim is pending');
reset role;
set local role service_role;
select lives_ok(
  $$update public.whatsapp_phone_numbers set connection_status = 'connected' where id = (select kp_account from tests.ids)$$,
  'the service role can verify the real owner despite the pending claim');
select throws_ok(
  $$update public.whatsapp_phone_numbers set connection_status = 'connected' where id = (select ns_account from tests.ids)$$,
  '23505', null, 'two connected accounts can never hold the same receiving number');
-- The webhook's lookup (DatabaseWhatsAppChannels.forReceivingNumber) trusts connected rows only.
select is(
  (select array_agg(company_id) from public.whatsapp_phone_numbers
   where phone_number_id = '109876543210987' and connection_status = 'connected'),
  array['20000000-0000-4000-8000-000000000002'::uuid],
  'the receiving number resolves to the verified owner only, never to the pending claimant');
reset role;
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'whatsapp_phone_numbers'
   and indexdef like 'CREATE UNIQUE INDEX % ON public.whatsapp_phone_numbers USING btree (phone_number_id) WHERE (connection_status = ''connected''::%'),
  1::bigint, 'connected receiving numbers are unique, and the index serves the webhook''s lookup');

select * from finish();
rollback;
