-- Guards added by 20261109100700_whatsapp_token_reference_bound, 20261109100800_lock_approved_message_content
-- and 20261109101600_communication_writer_guards (which closes the approved -> rejected -> edit ->
-- approved bypass) and 20261109102100_whatsapp_account_configuration (the token reference is forced).
-- Since 20261110100300_communication_lifecycle the content lock and the transition table also hold for
-- the backend (service role).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(24);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;

-- Messages, created as the database owner: 'approved' and 'worker' (approved by Naledi, as the API
-- allows) and 'never_approved' (rejected at its only approval request, so it was never approved).
create table tests.msgs (name text primary key, id uuid not null);
with tenant as (
  select t.company_id, t.id, t.whatsapp_number from public.tenants t
  where t.company_id = (select nexus from tests.ids) and t.whatsapp_verified order by t.id limit 1
), ins as (
  insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
    counterparty_number, company_number, body, status)
  select tenant.company_id, 'whatsapp', 'outbound', 'monthly_statement', 'tenant', tenant.id, tenant.whatsapp_number,
    '+27115550100', format('Good day. Your October 2026 statement is ready for you. (%s)', n), 'pending_approval'
  from tenant, unnest(array['approved', 'never_approved', 'worker']) n
  returning id, body
)
insert into tests.msgs select substring(body from '\((.*)\)$'), id from ins;
insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
select (select nexus from tests.ids), id, (select naledi from tests.ids),
  case name when 'never_approved' then 'rejected' else 'approved' end::public.approval_decision, (select naledi from tests.ids), now()
from tests.msgs;
update public.communications set status = 'approved' where id in (select id from tests.msgs where name in ('approved', 'worker'));
update public.communications set status = 'rejected' where id = (select id from tests.msgs where name = 'never_approved');
grant select on tests.ids, tests.msgs to authenticated, service_role;

-- ------------------------------------------------------------------ WhatsApp token reference
select is(
  (select count(*) from public.whatsapp_phone_numbers
   where access_token_reference <> 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace(company_id::text, '-', ''))),
  0::bigint, 'every account references its own company''s token');
-- The reference is now always set by trigger, so a wrong value is replaced instead of rejected.
update public.whatsapp_phone_numbers
  set access_token_reference = 'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace((select kgalagadi from tests.ids)::text, '-', ''))
  where company_id = (select nexus from tests.ids);
update public.whatsapp_phone_numbers set access_token_reference = 'secret://env/WHATSAPP_ACCESS_TOKEN'
  where company_id = (select nexus from tests.ids);
select is(
  (select access_token_reference from public.whatsapp_phone_numbers where company_id = (select nexus from tests.ids)),
  'secret://env/WHATSAPP_ACCESS_TOKEN_' || upper(replace((select nexus from tests.ids)::text, '-', '')),
  'an account cannot reference another company''s token or a shared token variable');
select throws_ok(
  $$alter table public.whatsapp_phone_numbers disable trigger prepare_account;
    update public.whatsapp_phone_numbers set access_token_reference = 'secret://env/WHATSAPP_ACCESS_TOKEN'
    where company_id = (select nexus from tests.ids)$$,
  '23514', null, 'the company-bound CHECK still backs the trigger');
alter table public.whatsapp_phone_numbers enable trigger prepare_account;

-- ------------------------------------------------------------------ approved message content, as a writer
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok(
  $$update public.communications set body = 'Please pay into account 1234567890' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'the body of an approved message cannot be changed');
select throws_ok(
  $$update public.communications set counterparty_number = '+27820000000' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'the recipient number of an approved message cannot be changed');
select throws_ok(
  $$update public.communications set attachment_file_name = 'other.pdf' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'the attachment of an approved message cannot be changed');
select throws_ok(
  $$update public.communications set statement_id = (select id from public.statements where company_id = (select nexus from tests.ids) order by id limit 1)
    where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'the linked statement of an approved message cannot be changed');
select throws_ok(
  $$update public.communications set status = 'draft' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'an approved message cannot be returned to draft');
select throws_ok(
  $$update public.communications set status = 'pending_approval' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'an approved message cannot be returned to pending approval');
select lives_ok(
  $$update public.communications set status = 'rejected' where id = (select id from tests.msgs where name = 'approved')$$,
  'an approved message can still be stopped (rejected)');

-- The bypass of 20261109100800: approved -> rejected -> edit -> approved under the old approval.
select throws_ok(
  $$update public.communications set body = 'Good day. Your corrected October 2026 statement is ready.' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'a once-approved message stays locked after it was rejected (a correction is a new message)');
select throws_ok(
  $$update public.communications set status = 'approved' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'a once-approved, rejected message cannot be released again under the old approval');
select throws_ok(
  $$update public.communications set status = 'pending_approval' where id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'a once-approved, rejected message cannot be resubmitted');
select throws_ok(
  $$insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
    select (select nexus from tests.ids), id, (select naledi from tests.ids) from tests.msgs where name = 'approved'$$,
  '42501', null, 'a once-approved message cannot get a new approval request');
select throws_ok(
  $$update public.message_approvals set decision = 'rejected' where communication_id = (select id from tests.msgs where name = 'approved')$$,
  '42501', null, 'a decided approval cannot be re-decided');

-- A message that was never approved can still be corrected and resubmitted.
select lives_ok(
  $$update public.communications set body = 'Good day. Your corrected October 2026 statement is ready.' where id = (select id from tests.msgs where name = 'never_approved')$$,
  'a rejected message that was never approved can be corrected');
select throws_ok(
  $$update public.communications set status = 'approved' where id = (select id from tests.msgs where name = 'never_approved')$$,
  '42501', null, 'a rejected message is not released directly; it is resubmitted for approval');
select lives_ok(
  $$update public.communications set status = 'pending_approval' where id = (select id from tests.msgs where name = 'never_approved')$$,
  'a rejected message that was never approved can be resubmitted for approval');
reset role;

-- ------------------------------------------------------------------ governing approval (database guard)
-- Even without the writer guard (as the database owner), only the latest decision counts: an old
-- approval followed by a later rejection does not let the message be released.
insert into public.message_approvals (company_id, communication_id, requested_by_user_id, requested_at, decision, decided_by_user_id, decided_at)
select (select nexus from tests.ids), id, (select naledi from tests.ids), now() + interval '1 minute', 'rejected', (select naledi from tests.ids), now()
from tests.msgs where name = 'approved';
set constraints all immediate;
select throws_ok(
  $$update public.communications set status = 'approved' where id = (select id from tests.msgs where name = 'approved')$$,
  '23514', null, 'a message whose latest approval decision is a rejection cannot be released');
set constraints all deferred;

-- ------------------------------------------------------------------ the worker (service role) goes through the lifecycle
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select throws_ok(
  $$update public.communications set body = 'Please pay into account 1234567890' where id = (select id from tests.msgs where name = 'worker')$$,
  '42501', null, 'the backend cannot change the content of an approved message either');
select throws_ok(
  $$update public.communications set status = 'sent', sent_at = now(), external_message_id = 'wamid.test-lock'
    where id = (select id from tests.msgs where name = 'worker')$$,
  '42501', null, 'the backend cannot record a send it never claimed (approved -> sent is not a transition)');
select isnt(public.claim_communication((select nexus from tests.ids), (select id from tests.msgs where name = 'worker')), null,
  'the worker claims the approved message');
select is(public.record_communication_sent((select nexus from tests.ids), (select id from tests.msgs where name = 'worker'), 'wamid.test-lock'),
  'recorded', 'the worker records delivery progress through the lifecycle');
reset role;
select is((select status::text from public.communications where id = (select id from tests.msgs where name = 'worker')), 'sent',
  'the delivery status was recorded');

select * from finish();
rollback;
