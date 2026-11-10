-- Auth and onboarding database contract: company_invitations (20261109101900), membership management
-- (20261109102000), WhatsApp configuration (20261109102100), company settings grants (20261109101800)
-- and activation on first use of the invitation link (20261109102200, narrowed by 20261109102300: the
-- link activates the profile only; acceptance is tested in invitation_acceptance.test.sql).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(59);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Membership role / is_default, read as the database owner.
create function tests.role_of(p_company uuid, p_user uuid) returns text
language sql security definer set search_path = '' as $$
  select role::text from public.company_users where company_id = p_company and user_id = p_user
$$;
create function tests.invitation(p_email text) returns public.company_invitations
language sql security definer set search_path = '' as $$
  select * from public.company_invitations where email = p_email order by created_at desc, id limit 1
$$;
create function tests.audits(p_summary text) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.audit_logs where summary like p_summary
$$;
-- Fixture ids: NS 20000000-...-0001, KP 20000000-...-0002; thandi ...0001 (NS admin), sipho ...0002,
-- naledi ...0003, kabelo ...0004 (users 10000000-0000-4000-8000-00000000000x).

-- ================================================================== invitations
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$insert into public.company_invitations (company_id, email, full_name, role)
    values ('20000000-0000-4000-8000-000000000001', '  Mixed.Case@Example.co.za ', 'Mixed Case', 'read_only')$$,
  'a company admin can invite a user');
select is(
  (select row(email, status, invited_by_user_id)::text from tests.invitation('mixed.case@example.co.za')),
  row('mixed.case@example.co.za', 'pending', '10000000-0000-4000-8000-000000000001'::uuid)::text,
  'the invitation is stored lower-case and trimmed, pending, invited by the signed-in admin');
select is(tests.audits('Invited mixed.case@example.co.za as read only'), 1::bigint, 'creating an invitation is audited');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role, status)
    values ('20000000-0000-4000-8000-000000000001', 'sent.already@example.co.za', 'read_only', 'sent')$$,
  '42501', null, 'an invitation cannot be created already sent');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role, invited_user_id)
    values ('20000000-0000-4000-8000-000000000001', 'linked@example.co.za', 'read_only', '10000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'an invitation cannot be created with an invited user (set by the worker)');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role, invited_by_user_id)
    values ('20000000-0000-4000-8000-000000000001', 'forged@example.co.za', 'read_only', '10000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'an invitation cannot be created in another user''s name');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role)
    values ('20000000-0000-4000-8000-000000000002', 'other.company@example.co.za', 'read_only')$$,
  '42501', null, 'an admin cannot invite to a company they do not administer');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role)
    values ('20000000-0000-4000-8000-000000000001', 'NEW.MANAGER@nexussolution.co.za', 'read_only')$$,
  '23505', null, 'only one open invitation per email and company');
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role)
    values ('20000000-0000-4000-8000-000000000001', 'not-an-email', 'read_only')$$,
  '23514', null, 'the email must look like an email address');

select lives_ok(
  $$update public.company_invitations set status = 'revoked' where email = 'mixed.case@example.co.za'$$,
  'a company admin can revoke an open invitation');
select isnt((tests.invitation('mixed.case@example.co.za')).revoked_at, null, 'revoking records when');
select is(tests.audits('Revoked the invitation for mixed.case@example.co.za'), 1::bigint, 'revoking is audited');
select throws_ok(
  $$update public.company_invitations set status = 'pending' where email = 'mixed.case@example.co.za'$$,
  '42501', null, 'a revoked invitation cannot be reopened');
select throws_ok(
  $$update public.company_invitations set status = 'accepted' where email = 'new.manager@nexussolution.co.za'$$,
  '42501', null, 'a signed-in admin cannot mark an invitation accepted');
select throws_ok(
  $$update public.company_invitations set status = 'declined' where email = 'new.manager@nexussolution.co.za'$$,
  '42501', null, 'a signed-in admin cannot mark an invitation declined');
select throws_ok(
  $$update public.company_invitations set email = 'changed@example.co.za' where email = 'new.manager@nexussolution.co.za'$$,
  '42501', null, 'an invitation''s email cannot be changed');
select throws_ok(
  $$delete from public.company_invitations where email = 'new.manager@nexussolution.co.za'$$,
  '42501', null, 'invitations are never deleted by signed-in users');
select lives_ok(
  $$insert into public.company_invitations (company_id, email, role)
    values ('20000000-0000-4000-8000-000000000001', 'mixed.case@example.co.za', 'property_manager')$$,
  'after a revoke the same email can be invited again');

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select throws_ok(
  $$insert into public.company_invitations (company_id, email, role)
    values ('20000000-0000-4000-8000-000000000001', 'pm.invite@example.co.za', 'read_only')$$,
  '42501', null, 'a property manager cannot invite');
select is((select count(*) from public.company_invitations), 0::bigint, 'a property manager cannot see invitations');
reset role;

-- ================================================================== WhatsApp configuration
-- Conversations keep their receiving number; the fixture's goes first so the numbers can be removed.
delete from public.whatsapp_conversations where company_id = '20000000-0000-4000-8000-000000000001';
delete from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000001', 'waba-1', 'phone-1', 'Nexus', '+27 11 555 0100')$$,
  'a company admin can configure WhatsApp');
-- Members cannot read the credential reference (20261110100400), so the owner checks it.
reset role;
select is(
  (select row(connection_status, webhook_configured, access_token_reference)::text from public.whatsapp_phone_numbers
   where company_id = '20000000-0000-4000-8000-000000000001'),
  row('pending_verification'::public.whatsapp_connection_status, false,
      'secret://env/WHATSAPP_ACCESS_TOKEN_20000000000040008000000000000001')::text,
  'a new account starts pending verification with the company-bound token reference');
set local role authenticated;
select throws_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, access_token_reference)
    values ('20000000-0000-4000-8000-000000000001', 'waba-1', 'phone-1', 'Nexus', '+27 11 555 0100', 'secret://env/OTHER')$$,
  '42501', null, 'an admin cannot supply the token reference');
reset role;
update public.whatsapp_phone_numbers set connection_status = 'connected', webhook_configured = true, last_verified_at = now()
  where company_id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok(
  $$update public.whatsapp_phone_numbers set display_name = 'Nexus Solution' where company_id = '20000000-0000-4000-8000-000000000001'$$,
  'an admin can change display details');
select is(
  (select connection_status::text from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001'),
  'connected', 'changing display details keeps the verified connection');
select lives_ok(
  $$insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number)
    values ('20000000-0000-4000-8000-000000000001', 'waba-2', 'phone-1', 'Nexus Solution', '+27 11 555 0100')
    on conflict (company_id, phone_number_id) do update set company_id = excluded.company_id, business_account_id = excluded.business_account_id,
      phone_number_id = excluded.phone_number_id, display_name = excluded.display_name, display_number = excluded.display_number$$,
  'an admin can upsert the configuration (PostgREST upsert shape)');
select is(
  (select connection_status::text from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001'),
  'pending_verification', 'new Meta identifiers need verifying again');
select throws_ok(
  $$update public.whatsapp_phone_numbers set connection_status = 'connected' where company_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'connection status is recorded by the service role only');
select throws_ok(
  $$update public.whatsapp_phone_numbers set webhook_configured = true where company_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'webhook state is recorded by the service role only');
select throws_ok(
  $$update public.whatsapp_phone_numbers set last_verified_at = now() where company_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'verification time is recorded by the service role only');
select throws_ok(
  $$delete from public.whatsapp_phone_numbers where company_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a signed-in admin cannot delete the configuration');
reset role;
set local role service_role;
select lives_ok(
  $$update public.whatsapp_phone_numbers set connection_status = 'connected', webhook_configured = true, last_verified_at = now()
    where company_id = '20000000-0000-4000-8000-000000000001'$$,
  'the service role records a verified connection');
reset role;

-- ================================================================== company settings
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$update public.companies set status = 'active' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an admin cannot change the company status');
select throws_ok(
  $$update public.companies set timezone = 'Africa/Johannesburg' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an admin cannot change the platform-managed timezone');
select throws_ok(
  $$update public.companies set initials = 'ZZ' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an admin cannot change the company initials');
select lives_ok(
  $$update public.companies set contact_phone = '+27 11 555 0199', payment_reminder_initial_days = 2
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'an admin can update profile and settings columns');
reset role;

-- ================================================================== membership
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$insert into public.company_users (company_id, user_id, role)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 'read_only')$$,
  '42501', null, 'an admin cannot enrol users directly (memberships come from invitations)');
select lives_ok(
  $$update public.company_users set role = 'property_manager'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000004'$$,
  'an admin can change another member''s role');
select is(tests.role_of('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004'), 'property_manager',
  'the role was changed');
select throws_ok(
  $$update public.company_users set role = 'property_manager'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an admin cannot change their own role');
select throws_ok(
  $$update public.company_users set is_default = false
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000003'$$,
  '42501', null, 'an admin cannot change another user''s default workspace');
select throws_ok(
  $$delete from public.company_users
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an admin cannot remove themselves');
reset role;

-- Thandi is Nexus's only company admin.
set local role service_role;
select throws_ok(
  $$update public.company_users set role = 'property_manager'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'the last active company admin cannot be demoted (service role included)');
select throws_ok(
  $$delete from public.company_users
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'the last active company admin cannot be removed (service role included)');
reset role;

set local role authenticated;
select lives_ok(
  $$update public.company_users set role = 'company_admin'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000003'$$,
  'an admin can make another member company admin');
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select lives_ok(
  $$update public.company_users set role = 'property_manager'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  'with a second admin, the first can be demoted');
select lives_ok(
  $$delete from public.company_users
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000004'$$,
  'an admin can remove another member');
select is(tests.role_of('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004'), null,
  'the member was removed');
reset role;
-- A suspended admin does not count: suspend Naledi (now the only admin), then removing her is allowed
-- (she no longer holds active admin access anyway), while demoting an active last admin is not.
update public.company_users set role = 'company_admin'
  where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001';
update public.profiles set status = 'suspended' where id = '10000000-0000-4000-8000-000000000003';
set local role service_role;
select lives_ok(
  $$update public.company_users set role = 'read_only'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000003'$$,
  'demoting a suspended admin is allowed while an active admin remains');
select throws_ok(
  $$update public.company_users set role = 'read_only'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'suspended admins do not count towards keeping an active admin');
reset role;

-- Other members and own rows.
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
set local role authenticated;
delete from public.company_users
  where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000005';
select is(tests.role_of('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'), 'property_owner',
  'a property manager cannot remove members');
select throws_ok(
  $$update public.company_users set role = 'company_admin'
    where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a member cannot change their own role');
select lives_ok(
  $$update public.company_users set is_default = false where user_id = '10000000-0000-4000-8000-000000000002';
    update public.company_users set is_default = true
    where company_id = '20000000-0000-4000-8000-000000000002' and user_id = '10000000-0000-4000-8000-000000000002'$$,
  'a user can choose their own default workspace');
reset role;

-- ================================================================== activation on first use of the invite link
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, invited_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated',
   'invitee@example.co.za', '{"full_name":"Invitee"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated',
   'suspended.invitee@example.co.za', '{"full_name":"Suspended Invitee"}', now(), now(), now());
select is((select status::text from public.profiles where id = '10000000-0000-4000-8000-000000000101'), 'invited',
  'a new auth user gets an invited profile');
-- The worker's shape: the invitation is sent and linked to the user; no membership is created.
set local role service_role;
insert into public.company_invitations (company_id, email, role, invited_user_id, status, sent_at)
values ('20000000-0000-4000-8000-000000000001', 'invitee@example.co.za', 'read_only', '10000000-0000-4000-8000-000000000101', 'sent', now()),
       ('20000000-0000-4000-8000-000000000001', 'suspended.invitee@example.co.za', 'read_only', '10000000-0000-4000-8000-000000000102', 'sent', now());
reset role;
update public.profiles set status = 'suspended' where id = '10000000-0000-4000-8000-000000000102';

-- Supabase Auth confirms the email when the invite link is used.
update auth.users set email_confirmed_at = now() where id in ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102');
select is((select status::text from public.profiles where id = '10000000-0000-4000-8000-000000000101'), 'active',
  'using the invite link activates the invited profile');
select is((tests.invitation('invitee@example.co.za')).status, 'sent',
  'but no longer accepts the invitation (the invitee accepts in the app)');
select is(
  (select count(*) from public.company_users where user_id in ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102')),
  0::bigint, 'and creates no membership');
select is((select status::text from public.profiles where id = '10000000-0000-4000-8000-000000000102'), 'suspended',
  'a suspended profile is never re-activated');
select is((tests.invitation('suspended.invitee@example.co.za')).status, 'sent',
  'and its invitation is not accepted');

select * from finish();
rollback;
