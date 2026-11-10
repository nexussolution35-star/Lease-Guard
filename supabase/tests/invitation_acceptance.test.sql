-- Invitee-side invitation contract (migration 20261109102300_invitation_acceptance):
-- accept_company_invitation, decline_company_invitation and list_my_company_invitations.
-- A membership is created only when the invitee accepts their own sent invitation while signed in with
-- the invited, confirmed email. Every refusal is the same 42501 'This invitation is not available'.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(50);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Fixture: NS 20000000-...-0001 (admin thandi), KP 20000000-...-0002. kabelo is an NS read_only member;
-- lerato is a KP property_owner whose default workspace is KP.
-- New users: alice (confirmed, profile invited, no memberships), bob (email NOT confirmed),
-- carol (confirmed, profile suspended), dave (confirmed; his invitation is revoked).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at, invited_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated',
   'alice@example.co.za', now(), '{"full_name":"Alice"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated',
   'bob@example.co.za', null, '{"full_name":"Bob"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated',
   'carol@example.co.za', now(), '{"full_name":"Carol"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated',
   'dave@example.co.za', now(), '{"full_name":"Dave"}', now(), now(), now());
update public.profiles set status = 'suspended' where id = '10000000-0000-4000-8000-000000000203';

insert into public.companies (id, name, address_line1, suburb, city, province, postal_code, contact_email, contact_phone, initials)
values ('20000000-0000-4000-8000-000000000003', 'Third Company', '3 Main Road', 'Rosebank', 'Johannesburg', 'Gauteng', '2196',
        'info@third.co.za', '+27 11 555 0300', 'TC');

-- Invitations as the worker leaves them (no membership anywhere).
insert into public.company_invitations (id, company_id, email, role, status, sent_at, invited_by_user_id, failure_reason)
values
  ('a0000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'alice@example.co.za', 'property_manager', 'sent', now(), '10000000-0000-4000-8000-000000000001', null),
  ('a0000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000002', 'alice@example.co.za', 'read_only', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000a3', '20000000-0000-4000-8000-000000000003', 'alice@example.co.za', 'read_only', 'pending', null, null, null),
  ('a0000000-0000-4000-8000-0000000000a4', '20000000-0000-4000-8000-000000000003', 'alice@example.co.za', 'read_only', 'revoked', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000a5', '20000000-0000-4000-8000-000000000003', 'alice@example.co.za', 'read_only', 'declined', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000a6', '20000000-0000-4000-8000-000000000003', 'alice@example.co.za', 'read_only', 'accepted', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000a7', '20000000-0000-4000-8000-000000000003', 'alice@example.co.za', 'read_only', 'failed', null, null, 'smtp'),
  ('a0000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-000000000001', 'bob@example.co.za', 'read_only', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-000000000001', 'carol@example.co.za', 'read_only', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-000000000001', 'dave@example.co.za', 'read_only', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-000000000001', 'someone.else@example.co.za', 'read_only', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-000000000001', 'kabelo.molefe@nexussolution.co.za', 'company_admin', 'sent', now(), null, null),
  ('a0000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-000000000001', 'lerato@kgalagadiproperty.co.za', 'read_only', 'sent', now(), null, null);

-- ================================================================== privileges
select ok(not has_function_privilege('anon', 'public.accept_company_invitation(uuid)', 'execute'), 'anon cannot execute accept');
select ok(not has_function_privilege('anon', 'public.decline_company_invitation(uuid)', 'execute'), 'anon cannot execute decline');
select ok(not has_function_privilege('anon', 'public.list_my_company_invitations()', 'execute'), 'anon cannot execute list');
select ok(
  has_function_privilege('authenticated', 'public.accept_company_invitation(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.decline_company_invitation(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.list_my_company_invitations()', 'execute'),
  'signed-in users can execute all three');
select ok(not has_function_privilege('authenticated', 'private.lock_own_sent_invitation(uuid)', 'execute'),
  'the private lookup helper is not callable directly');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('accept_company_invitation', 'decline_company_invitation', 'list_my_company_invitations')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  3::bigint, 'all three are SECURITY DEFINER with an empty search_path');
set local role anon;
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'anon calling accept is refused');
reset role;

-- ================================================================== list
select set_config('request.jwt.claims', tests.claims('alice@example.co.za'), true);
set local role authenticated;
select results_eq(
  $$select id, company_name, role::text, invited_by_name from public.list_my_company_invitations() order by company_name$$,
  $$values ('a0000000-0000-4000-8000-0000000000a2'::uuid, 'Kgalagadi Property Holdings', 'read_only', null::text),
           ('a0000000-0000-4000-8000-0000000000a1'::uuid, 'Nexus Solution', 'property_manager', 'Thandi Mokoena')$$,
  'the invitee lists only their own sent invitations, with company and inviter names');
select is((select count(*) from public.companies), 0::bigint, 'RLS still hides the companies from a non-member');
select set_config('request.jwt.claims', tests.claims('bob@example.co.za'), true);
select is((select count(*) from public.list_my_company_invitations()), 0::bigint,
  'an unconfirmed email lists nothing');
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select is((select count(*) from public.list_my_company_invitations()), 0::bigint,
  'an admin does not see other people''s invitations through the list');
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.list_my_company_invitations()), 0::bigint,
  'no signed-in user lists nothing');

-- ================================================================== refusals (all the same generic error)
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'This invitation is not available', 'without a signed-in user acceptance is refused');

select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'This invitation is not available', 'another user cannot accept someone else''s invitation');
select throws_ok($$select public.decline_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'This invitation is not available', 'another user cannot decline someone else''s invitation');

select set_config('request.jwt.claims', tests.claims('alice@example.co.za'), true);
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000e1')$$,
  '42501', 'This invitation is not available', 'an invitation for another email cannot be accepted');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a3')$$,
  '42501', 'This invitation is not available', 'a pending (not yet sent) invitation cannot be accepted');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a4')$$,
  '42501', 'This invitation is not available', 'a revoked invitation cannot be accepted');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a5')$$,
  '42501', 'This invitation is not available', 'a declined invitation cannot be accepted');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a6')$$,
  '42501', 'This invitation is not available', 'an accepted invitation cannot be accepted again');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a7')$$,
  '42501', 'This invitation is not available', 'a failed invitation cannot be accepted');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-00000000ffff')$$,
  '42501', 'This invitation is not available', 'an unknown invitation gives the same error');

select set_config('request.jwt.claims', tests.claims('bob@example.co.za'), true);
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000b1')$$,
  '42501', 'This invitation is not available', 'an unconfirmed email cannot accept its invitation');
select throws_ok($$select public.decline_company_invitation('a0000000-0000-4000-8000-0000000000b1')$$,
  '42501', 'This invitation is not available', 'an unconfirmed email cannot decline its invitation');

select set_config('request.jwt.claims', tests.claims('carol@example.co.za'), true);
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000c1')$$,
  '42501', 'This invitation is not available', 'a suspended profile cannot accept');
reset role;
select is(
  (select count(*) from public.company_users where user_id in ('10000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000203')),
  0::bigint, 'refused acceptances create no membership');
select is((select status::text from public.profiles where id = '10000000-0000-4000-8000-000000000203'), 'suspended',
  'and the suspended profile is not re-activated');
select is((select status from public.company_invitations where id = 'a0000000-0000-4000-8000-0000000000c1'), 'sent',
  'and the invitation stays sent');

-- Revoke before acceptance.
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
update public.company_invitations set status = 'revoked' where id = 'a0000000-0000-4000-8000-0000000000d1';
select set_config('request.jwt.claims', tests.claims('dave@example.co.za'), true);
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000d1')$$,
  '42501', 'This invitation is not available', 'an invitation revoked before acceptance cannot be accepted');
reset role;
select is((select count(*) from public.company_users where user_id = '10000000-0000-4000-8000-000000000204'), 0::bigint,
  'and no membership exists for the revoked invitee');

-- ================================================================== acceptance
select set_config('request.jwt.claims', tests.claims('alice@example.co.za'), true);
set local role authenticated;
select is(public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a1'), '20000000-0000-4000-8000-000000000001'::uuid,
  'the invitee accepts their own sent invitation and gets the company id');
select is((select count(*) from public.companies where id = '20000000-0000-4000-8000-000000000001'), 1::bigint,
  'the new member can now see the company');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'This invitation is not available', 'accepting twice is refused');
reset role;
select results_eq(
  $$select company_id, role::text, is_default from public.company_users where user_id = '10000000-0000-4000-8000-000000000201'$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid, 'property_manager', true)$$,
  'acceptance creates exactly one membership with the invited role, default when the user had none');
select is(
  (select row(status, accepted_at is not null, invited_user_id)::text from public.company_invitations where id = 'a0000000-0000-4000-8000-0000000000a1'),
  row('accepted', true, '10000000-0000-4000-8000-000000000201'::uuid)::text,
  'the invitation is accepted, timed and linked to the user');
select is((select status::text from public.profiles where id = '10000000-0000-4000-8000-000000000201'), 'active',
  'an invited profile becomes active on acceptance');
select is((select count(*) from public.audit_logs where summary = 'alice@example.co.za accepted the invitation to join as property manager'
           and actor_user_id = '10000000-0000-4000-8000-000000000201'), 1::bigint,
  'acceptance is audited with the invitee as actor');

-- An existing member keeps their role; a user with a default workspace keeps it.
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is(public.accept_company_invitation('a0000000-0000-4000-8000-0000000000f1'), '20000000-0000-4000-8000-000000000001'::uuid,
  'an existing member can accept');
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select lives_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000f2')$$,
  'a member of another company can accept');
reset role;
select results_eq(
  $$select role::text from public.company_users where company_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000004'$$,
  $$values ('read_only')$$,
  'acceptance does not change an existing member''s role (still one membership)');
select is((select status from public.company_invitations where id = 'a0000000-0000-4000-8000-0000000000f1'), 'accepted',
  'the existing member''s invitation is still marked accepted');
select results_eq(
  $$select company_id, role::text, is_default from public.company_users where user_id = '10000000-0000-4000-8000-000000000007' order by is_default desc$$,
  $$values ('20000000-0000-4000-8000-000000000002'::uuid, 'property_owner', true),
           ('20000000-0000-4000-8000-000000000001'::uuid, 'read_only', false)$$,
  'the new membership is not default when the user already has a default workspace');

-- ================================================================== decline
select set_config('request.jwt.claims', tests.claims('alice@example.co.za'), true);
set local role authenticated;
select lives_ok($$select public.decline_company_invitation('a0000000-0000-4000-8000-0000000000a2')$$,
  'the invitee can decline their own sent invitation');
select throws_ok($$select public.decline_company_invitation('a0000000-0000-4000-8000-0000000000a2')$$,
  '42501', 'This invitation is not available', 'declining twice is refused');
select throws_ok($$select public.accept_company_invitation('a0000000-0000-4000-8000-0000000000a2')$$,
  '42501', 'This invitation is not available', 'a declined invitation cannot then be accepted');
select throws_ok($$select public.decline_company_invitation('a0000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'This invitation is not available', 'an accepted invitation cannot be declined');
select is((select count(*) from public.list_my_company_invitations()), 0::bigint,
  'accepted and declined invitations leave the list');
reset role;
select is((select status from public.company_invitations where id = 'a0000000-0000-4000-8000-0000000000a2'), 'declined',
  'the invitation is declined');
select is((select count(*) from public.company_users
           where company_id = '20000000-0000-4000-8000-000000000002' and user_id = '10000000-0000-4000-8000-000000000201'),
  0::bigint, 'declining creates no membership');
select is((select count(*) from public.audit_logs where summary = 'alice@example.co.za declined the invitation to join as read only'),
  1::bigint, 'declining is audited');

select * from finish();
rollback;
