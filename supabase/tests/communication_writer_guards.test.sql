-- Delivery state is recorded only by the delivery worker (migration 20261109101600_communication_writer_guards),
-- and a decision made as two direct writes (the approval, then the status) still works under the grants
-- and guards. The API itself now decides in one transaction through public.decide_communication (the
-- communication lifecycle, 20261110100300; see communication_lifecycle.test.sql); the "API approve"
-- steps below are the writes a signed-in writer can still make directly.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(15);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- An approved (unsent) and a failed tenant message, created as the database owner.
insert into public.communications (id, company_id, channel, direction, message_type, recipient_type, tenant_id,
  counterparty_number, company_number, body, status, failure_reason)
values
  ('91000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'whatsapp', 'outbound', 'overdue_payment_reminder',
   'tenant', '50000000-0000-4000-8000-000000000001', '+27821110001', '+27115550100', 'Your account is overdue.', 'approved', null),
  ('91000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'whatsapp', 'outbound', 'overdue_payment_reminder',
   'tenant', '50000000-0000-4000-8000-000000000001', '+27821110001', '+27115550100', 'Your account is overdue.', 'failed', 'WhatsApp not connected');
insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
select '20000000-0000-4000-8000-000000000001', id, '10000000-0000-4000-8000-000000000003', 'approved', '10000000-0000-4000-8000-000000000003', now()
from public.communications where id::text like '91000000-0000-4000-8000-%';

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

-- ------------------------------------------------------------------ forged delivery state
select throws_ok(
  $$update public.communications set status = 'delivered' where id = '91000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a writer cannot mark an approved message delivered');
select throws_ok(
  $$update public.communications set status = 'read' where id = '91000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a writer cannot mark a failed message read');
select throws_ok(
  $$update public.communications set sent_at = now() where id = '91000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a writer cannot set sent_at');
select throws_ok(
  $$update public.communications set external_message_id = 'wamid.FAKE' where id = '91000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a writer cannot set the WhatsApp message id');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    values ('20000000-0000-4000-8000-000000000001', 'whatsapp', 'inbound', 'inbound_reply', 'tenant',
      '50000000-0000-4000-8000-000000000001', '+27821110001', '+27115550100', 'I dispute this', 'received')$$,
  '42501', null, 'a writer cannot insert an inbound tenant reply');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, owner_user_id,
      counterparty_number, company_number, body, status)
    values ('20000000-0000-4000-8000-000000000001', 'whatsapp', 'outbound', 'owner_weekly_summary', 'property_owner',
      '10000000-0000-4000-8000-000000000005', '+27825501194', '+27115550100', 'Summary', 'sent')$$,
  '42501', null, 'a writer cannot insert an already sent message');

-- ------------------------------------------------------------------ what writers still do
select lives_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    values ('20000000-0000-4000-8000-000000000001', 'whatsapp', 'outbound',
      'initial_payment_reminder', 'tenant', '50000000-0000-4000-8000-000000000001', '+27821110001', '+27115550100',
      'A friendly reminder.', 'draft')$$,
  'a writer can create a draft');
select lives_ok(
  $$update public.communications set body = 'A friendly reminder that rent is due.' where body like 'A friendly reminder%'$$,
  'a writer can edit a draft');
select lives_ok(
  $$update public.communications set status = 'pending_approval' where body like 'A friendly reminder%'$$,
  'a writer can submit a draft for approval');

-- ------------------------------------------------------------------ the API approval flow (fixture message awaiting approval)
set constraints all immediate;
select lives_ok(
  $$update public.message_approvals
    set decision = 'approved', decided_by_user_id = '10000000-0000-4000-8000-000000000003', decided_at = now(), reason = 'Checked'
    where company_id = '20000000-0000-4000-8000-000000000001' and communication_id = '90000000-0000-4000-8000-000000000001'
      and decision = 'pending'
    returning *$$,
  'API approve, step 1: the caller records the decision on the open request');
select lives_ok(
  $$update public.communications set status = 'approved'
    where company_id = '20000000-0000-4000-8000-000000000001' and id = '90000000-0000-4000-8000-000000000001'
      and status = 'pending_approval'
    returning *$$,
  'API approve, step 2: the caller moves the message to approved (the deferred approval guard passes)');
select is((select status::text from public.communications where id = '90000000-0000-4000-8000-000000000001'), 'approved',
  'the approved message is ready for the delivery worker');
select lives_ok(
  $$update public.communications set status = 'approved'
    where company_id = '20000000-0000-4000-8000-000000000001' and id = '90000000-0000-4000-8000-000000000001'
      and status = 'pending_approval'
    returning *$$,
  'API approve, retried step 2 is a harmless no-op');

select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select lives_ok(
  $$update public.message_approvals
    set decision = 'rejected', decided_by_user_id = '10000000-0000-4000-8000-000000000002', decided_at = now(), reason = 'Wrong amount'
    where company_id = '20000000-0000-4000-8000-000000000002' and communication_id = '90000000-0000-4000-8000-000000000005'
      and decision = 'pending'
    returning *$$,
  'API reject, step 1: the caller records the rejection');
select lives_ok(
  $$update public.communications set status = 'rejected'
    where company_id = '20000000-0000-4000-8000-000000000002' and id = '90000000-0000-4000-8000-000000000005'
      and status = 'pending_approval'
    returning *$$,
  'API reject, step 2: the caller moves the message to rejected');
set constraints all deferred;
reset role;

select * from finish();
rollback;
