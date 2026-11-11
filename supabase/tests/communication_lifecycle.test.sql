-- The outbound communication lifecycle (migration 20261110100300_communication_lifecycle): the
-- transition table is enforced for signed-in users AND the backend (service role), the backend writes
-- delivery state only through the lifecycle functions, every lifecycle operation is atomic and
-- conditional, "may have been sent" is a recorded fact that only the claim's holder can clear, and
-- WhatsApp status callbacks are monotonic and safe out of order. Concurrent claims are covered by
-- tests/integration/communication-lifecycle.test.ts (one transaction cannot race itself).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(80);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '20000000-0000-4000-8000-000000000002'::uuid as kgalagadi,
  '50000000-0000-4000-8000-000000000001'::uuid as tenant,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;
grant select on tests.ids to authenticated, service_role;

-- One Nexus tenant message per name, created as the database owner in the given status, with what that
-- status implies (an approved approval from the approved family on, a claim for queued, a WhatsApp id
-- once sent). 'inbound' is a received tenant reply.
create table tests.msgs (name text primary key, id uuid not null default gen_random_uuid());
grant select on tests.msgs to authenticated, service_role;
create function tests.message(p_name text, p_status public.delivery_status) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_status = 'received' then
    insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status, external_message_id)
    values ((select nexus from tests.ids), 'whatsapp', 'inbound', 'inbound_reply', 'tenant', (select tenant from tests.ids),
      '+27821110001', '+27115550100', format('Thanks (%s)', p_name), 'received', 'wamid.in-' || p_name)
    returning id into v_id;
  else
    insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    values ((select nexus from tests.ids), 'whatsapp', 'outbound', 'overdue_payment_reminder', 'tenant', (select tenant from tests.ids),
      '+27821110001', '+27115550100', format('Good day. Your account is overdue. (%s)', p_name), 'draft')
    returning id into v_id;
    if p_status in ('approved', 'queued', 'sent', 'delivered', 'read', 'failed') then
      insert into public.message_approvals (company_id, communication_id, requested_by_user_id, decision, decided_by_user_id, decided_at)
      values ((select nexus from tests.ids), v_id, (select naledi from tests.ids), 'approved', (select naledi from tests.ids), now());
    elsif p_status = 'pending_approval' then
      insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
      values ((select nexus from tests.ids), v_id, (select naledi from tests.ids));
    end if;
    update public.communications set
      status = p_status,
      send_uncertain_since = case when p_status = 'queued' then now() end,
      external_message_id = case when p_status in ('sent', 'delivered', 'read') then 'wamid.lc-' || p_name end,
      sent_at = case when p_status in ('sent', 'delivered', 'read') then now() end,
      failure_reason = case when p_status = 'failed' then 'WhatsApp not connected' end
    where id = v_id;
  end if;
  insert into tests.msgs (name, id) values (p_name, v_id);
  return v_id;
end;
$$;
create function tests.id(p_name text) returns uuid
language sql stable set search_path = '' as $$ select id from tests.msgs where name = p_name $$;

-- One message in every status for the transition sweeps, and one per scenario below.
select tests.message('from_' || s::text, s) from unnest(enum_range(null::public.delivery_status)) s;
select tests.message(n, s::public.delivery_status) from (values
  ('reopened_request', 'approved'), ('direct', 'pending_approval'), ('contradicted', 'pending_approval'), ('in_flight', 'queued'),
  ('owned', 'approved'), ('raced', 'approved'), ('bypass', 'approved')
) v(n, s);

-- Claim tokens handed out during the test, by name (the backend keeps them in memory).
create table tests.claims (name text primary key, token timestamptz);
grant select, insert on tests.claims to service_role;
create function tests.claim(p_name text) returns timestamptz
language sql stable set search_path = '' as $$ select token from tests.claims where name = p_name $$;

-- Every move NOT in the transition table for an actor, computed as the owner (the API roles cannot
-- read private tables).
create table tests.forbidden (actor text, from_status public.delivery_status, to_status public.delivery_status, id uuid);
insert into tests.forbidden
select a.actor, f.s, t.s, tests.id('from_' || f.s::text)
from unnest(array['user', 'system']) a(actor)
cross join unnest(enum_range(null::public.delivery_status)) f(s)
cross join unnest(enum_range(null::public.delivery_status)) t(s)
where f.s <> t.s
  and not exists (select 1 from private.communication_status_transitions x
                  where x.from_status = f.s and x.to_status = t.s and x.actor = a.actor);
grant select on tests.forbidden to authenticated, service_role;

-- Tries every forbidden move as the current role; returns the ones the database did not refuse with
-- 42501. Each attempt runs in its own subtransaction and is rolled back.
create function tests.unrefused_moves(p_actor text) returns setof text
language plpgsql set search_path = '' as $$
declare
  r record;
begin
  for r in select * from tests.forbidden where actor = p_actor loop
    begin
      update public.communications set status = r.to_status where id = r.id;
      raise sqlstate 'TSTOK';
    exception when others then
      if sqlstate <> '42501' then
        return next format('%s -> %s (%s)', r.from_status, r.to_status, case sqlstate when 'TSTOK' then 'allowed' else sqlstate end);
      end if;
    end;
  end loop;
end;
$$;

-- ================================================================== the transition table
select set_eq(
  $$select from_status::text, to_status::text, operation, actor from private.communication_status_transitions$$,
  $$values
    ('approved', 'failed', 'record_failed', 'system'), ('approved', 'queued', 'claim', 'system'),
    ('queued', 'approved', 'release', 'system'), ('queued', 'sent', 'record_sent', 'system'),
    ('queued', 'failed', 'record_failed', 'system'), ('sent', 'delivered', 'provider_status', 'system'),
    ('sent', 'read', 'provider_status', 'system'), ('sent', 'failed', 'provider_status', 'system'),
    ('delivered', 'read', 'provider_status', 'system'), ('failed', 'sent', 'record_sent', 'system'),
    ('rejected', 'sent', 'record_sent', 'system'),
    -- The AI agent's own reply to a contact (20261111100100), only inside complete_whatsapp_agent_run.
    ('pending_approval', 'approved', 'agent_approve', 'system'),
    ('draft', 'pending_approval', 'submit', 'user'), ('pending_approval', 'approved', 'decide', 'user'),
    ('pending_approval', 'rejected', 'decide', 'user'), ('approved', 'rejected', 'stop', 'user'),
    ('queued', 'rejected', 'stop', 'user'), ('failed', 'rejected', 'stop', 'user'),
    ('rejected', 'draft', 'reopen', 'user'), ('rejected', 'pending_approval', 'reopen', 'user')$$,
  'the transition table is exactly the documented state machine (backend/src/messaging/communication-lifecycle.ts)');
select is((select count(*) from tests.forbidden where actor = 'system'), 78::bigint, 'the backend has 78 forbidden moves to try');
select is((select count(*) from tests.forbidden where actor = 'user'), 82::bigint, 'signed-in users have 82 forbidden moves to try');
select ok(not exists (select 1 from private.communication_status_transitions where from_status = 'received' or to_status = 'received'),
  'an inbound received message never changes status');

-- ================================================================== who may call which operation
select ok(has_function_privilege('authenticated', 'public.decide_communication(uuid, uuid, uuid, public.approval_decision, text)', 'execute')
  and not has_function_privilege('service_role', 'public.decide_communication(uuid, uuid, uuid, public.approval_decision, text)', 'execute')
  and not has_function_privilege('anon', 'public.decide_communication(uuid, uuid, uuid, public.approval_decision, text)', 'execute'),
  'only signed-in users decide');
select ok(bool_and(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
    and not has_function_privilege('anon', f, 'execute')),
  'only the backend claims, releases and records sends, failures and provider statuses')
from unnest(array[
  'public.claim_communication(uuid, uuid)', 'public.release_communication_claim(uuid, uuid, timestamptz)',
  'public.record_communication_sent(uuid, uuid, text)', 'public.record_communication_failed(uuid, uuid, text, boolean, timestamptz)',
  'public.record_communication_provider_status(uuid, text, public.delivery_status, timestamptz, text)']) f;

-- ================================================================== the backend (service role)
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

select is_empty($$select * from tests.unrefused_moves('system')$$,
  'the backend is refused (42501) every status move outside the transition table');
reset role;
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select is_empty($$select * from tests.unrefused_moves('user')$$,
  'a signed-in user is refused (42501) every status move outside the transition table');
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

-- claim / release: a claim is owned by the token its winner gets
insert into tests.claims values ('first', public.claim_communication((select nexus from tests.ids), tests.id('from_approved')));
select isnt(tests.claim('first'), null, 'claim: an approved message is claimed; the winner gets the claim''s token');
select ok((select status = 'queued' and send_uncertain_since = tests.claim('first') from public.communications where id = tests.id('from_approved')),
  'claim: the message is queued and records that it may now be sent; the token names this claim');
select is(public.claim_communication((select nexus from tests.ids), tests.id('from_approved')), null, 'claim: a second claim loses (no token)');
select is(public.claim_communication((select kgalagadi from tests.ids), tests.id('from_approved')), null, 'claim: another company cannot claim it');
select ok(not public.release_communication_claim((select nexus from tests.ids), tests.id('from_approved'), tests.claim('first') - interval '1 second'),
  'release: a token that is not this claim''s releases nothing');
select throws_ok($$select public.release_communication_claim((select nexus from tests.ids), tests.id('from_approved'), null)$$,
  '22023', null, 'release: the claim''s token is required');
select ok(public.release_communication_claim((select nexus from tests.ids), tests.id('from_approved'), tests.claim('first')),
  'release: the holder hands the claim back');
select ok((select status = 'approved' and send_uncertain_since is null from public.communications where id = tests.id('from_approved')),
  'release: approved again, nothing was sent');
select ok(not public.release_communication_claim((select nexus from tests.ids), tests.id('from_approved'), tests.claim('first')),
  'release: only a queued message is released');
select is(current_setting('leaseguard.communication_lifecycle', true), '',
  'the lifecycle functions leave no operation named behind them');
-- Named as the claim operation so the write reaches the CHECK (the guard refuses it otherwise).
select set_config('leaseguard.communication_lifecycle', 'claim', true);
select throws_ok(
  $$update public.communications set status = 'queued' where id = tests.id('from_approved')$$,
  '23514', null, 'a claim always records that the send may happen (CHECK)');
select set_config('leaseguard.communication_lifecycle', '', true);

-- record failed
select ok(public.record_communication_failed((select nexus from tests.ids), tests.id('from_approved'), 'Template not approved', false),
  'record failed: an approved message fails before any send');
select ok((select status = 'failed' and send_uncertain_since is null and failure_reason = 'Template not approved'
  from public.communications where id = tests.id('from_approved')), 'record failed: certainly not sent');
select ok(public.record_communication_failed((select nexus from tests.ids), tests.id('from_queued'), 'WhatsApp did not answer', true),
  'record failed: a claimed message fails with an unknown outcome');
select ok((select status = 'failed' and send_uncertain_since is not null from public.communications where id = tests.id('from_queued')),
  'record failed: "may have been sent" is kept as a fact');
select ok(not public.record_communication_failed((select nexus from tests.ids), tests.id('from_sent'), 'late', true),
  'record failed: a sent message cannot be failed by the worker');
select throws_ok(
  $$update public.communications set send_uncertain_since = null where id = tests.id('from_queued')$$,
  '42501', null, 'the "may have been sent" fact is never cleared without a transition');

-- Only the claim's holder may say its send did not happen. Run A claims and is sending; run B of the
-- same job (stalled and re-run, or retried from the approve endpoint) fails before its own claim.
insert into tests.claims values ('raced_a', public.claim_communication((select nexus from tests.ids), tests.id('raced')));
select ok(not public.record_communication_failed((select nexus from tests.ids), tests.id('raced'), 'Delivery failed after 3 attempts: storage', false),
  'record failed: a run without the claim cannot record a claimed message as not sent');
select ok(not public.record_communication_failed((select nexus from tests.ids), tests.id('raced'), 'Refused', false, tests.claim('raced_a') - interval '1 second'),
  'record failed: ... nor with another claim''s token');
select ok((select status = 'queued' and send_uncertain_since = tests.claim('raced_a') and failure_reason is null
  from public.communications where id = tests.id('raced')), 'record failed: ... the claim and its "may have been sent" are untouched');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('raced'), 'wamid.raced-a'), 'recorded',
  'record failed: ... so run A''s send is still recorded');
-- The holder itself, after WhatsApp certainly refused (its final attempt, or a permanent refusal).
insert into tests.claims values ('owned', public.claim_communication((select nexus from tests.ids), tests.id('owned')));
select ok(public.record_communication_failed((select nexus from tests.ids), tests.id('owned'), 'Recipient is not on WhatsApp', false, tests.claim('owned')),
  'record failed: the holder records that its send certainly did not happen');
select ok((select status = 'failed' and send_uncertain_since is null from public.communications where id = tests.id('owned')),
  'record failed: ... and the message is certainly not sent');

-- record sent
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('from_draft'), 'wamid.never'), 'not_claimed',
  'record sent: a message that was never claimed cannot be recorded as sent');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('from_queued'), 'wamid.late-truth'), 'recorded',
  'record sent: a send that was still in flight when the message was failed is recorded (the truth wins)');
select ok((select status = 'sent' and external_message_id = 'wamid.late-truth' and send_uncertain_since is null and failure_reason is null
  and sent_at is not null from public.communications where id = tests.id('from_queued')), 'record sent: sent, with its id; the outcome is known');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('from_queued'), 'wamid.late-truth'), 'already_recorded',
  'record sent: repeating it is harmless');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('from_queued'), 'wamid.other'), 'conflict',
  'record sent: another id is never recorded over the first');
select is(public.record_communication_sent((select kgalagadi from tests.ids), tests.id('from_queued'), 'wamid.late-truth'), 'not_found',
  'record sent: scoped to the company');
select throws_ok(
  $$update public.communications set external_message_id = 'wamid.rewrite' where id = tests.id('from_queued')$$,
  '42501', null, 'a recorded WhatsApp id cannot be changed');

-- ================================================================== the backend cannot write around the lifecycle
insert into tests.claims values ('bypass', public.claim_communication((select nexus from tests.ids), tests.id('bypass')));
select throws_ok(
  $$update public.communications set status = 'sent', send_uncertain_since = null, external_message_id = 'wamid.direct' where id = tests.id('bypass')$$,
  '42501', null, 'bypass: a transition in the table is still refused when written directly');
select throws_ok(
  $$update public.communications set status = 'sent', send_uncertain_since = null where id = tests.id('bypass')$$,
  '42501', null, 'bypass: a claimed message cannot be marked sent directly (the fact would be erased without an id)');
select throws_ok(
  $$update public.communications set status = 'failed', send_uncertain_since = null, failure_reason = 'x' where id = tests.id('bypass')$$,
  '42501', null, 'bypass: nor failed as certainly not sent');
select throws_ok(
  $$update public.communications set delivered_at = now() where id = tests.id('from_delivered')$$,
  '42501', 'the backend records delivery progress only through the communication lifecycle',
  'bypass: a delivery time is recorded only by a WhatsApp status callback');
select throws_ok(
  $$update public.communications set failure_reason = 'rewritten' where id = tests.id('from_failed')$$,
  '42501', 'the backend records delivery progress only through the communication lifecycle',
  'bypass: a failure reason is never rewritten directly');
-- Even inside record_sent's own operation, "sent" needs the WhatsApp id (the guard's rule, not only the function's).
select set_config('leaseguard.communication_lifecycle', 'record_sent', true);
select throws_ok(
  $$update public.communications set status = 'sent', send_uncertain_since = null where id = tests.id('bypass')$$,
  '42501', 'a message is recorded as sent only with its WhatsApp message id',
  'bypass: "sent" is never recorded without the WhatsApp message id');
select set_config('leaseguard.communication_lifecycle', '', true);
select ok((select status = 'queued' and send_uncertain_since = tests.claim('bypass') from public.communications where id = tests.id('bypass')),
  'bypass: ... the claimed message is untouched');

-- ================================================================== WhatsApp status callbacks
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_sent', 'read', '2026-11-10 10:05+02'), 'advanced',
  'provider: "read" may follow "sent" directly (Meta can skip "delivered")');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_sent', 'delivered', '2026-11-10 10:01+02'), 'recorded',
  'provider: a late "delivered" after "read" records its time');
select ok((select status = 'read' and delivered_at = '2026-11-10 10:01+02' and read_at = '2026-11-10 10:05+02'
  from public.communications where id = tests.id('from_sent')), 'provider: ... and does not move the status back');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_sent', 'read', '2026-11-10 11:00+02'), 'unchanged',
  'provider: a repeated callback changes nothing (the first time is kept)');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_sent', 'failed', now(), 'Undeliverable'), 'unchanged',
  'provider: "failed" after "read" is contradicted and ignored');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_delivered', 'read', now()), 'advanced',
  'provider: delivered -> read');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.late-truth', 'failed', now(), '131049: not delivered'), 'advanced',
  'provider: a late failure of a sent message');
select ok((select status = 'failed' and failure_reason = '131049: not delivered' from public.communications where id = tests.id('from_queued')),
  'provider: ... is recorded with WhatsApp''s reason');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.late-truth', 'delivered', now()), 'recorded',
  'provider: a failed message stays failed; a later callback only records its time');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.unknown', 'read', now()), 'not_found',
  'provider: an id not recorded yet (the callback overtook record sent) changes nothing, for the caller to retry');
select is(public.record_communication_provider_status((select kgalagadi from tests.ids), 'wamid.lc-from_delivered', 'read', now()), 'not_found',
  'provider: scoped to the company that owns the receiving number');
select is(public.record_communication_provider_status((select nexus from tests.ids), 'wamid.in-from_received', 'read', now()), 'not_found',
  'provider: an inbound message id is not an outbound send');
select throws_ok(
  $$select public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_delivered', 'queued', now())$$,
  '22023', null, 'provider: only sent, delivered, read and failed are statuses WhatsApp reports');

-- ================================================================== inbound messages
select lives_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status, external_message_id)
    values ((select nexus from tests.ids), 'whatsapp', 'inbound', 'inbound_reply', 'tenant', (select tenant from tests.ids),
      '+27821110001', '+27115550100', 'When is my statement due?', 'received', 'wamid.in-webhook')$$,
  'the backend (webhook) can record a received inbound message');
select throws_ok(
  $$update public.communications set status = 'read' where external_message_id = 'wamid.in-webhook'$$,
  '42501', null, 'a received inbound message never changes status, even for the backend');
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status, external_message_id)
    values ((select nexus from tests.ids), 'whatsapp', 'outbound', 'overdue_payment_reminder', 'tenant', (select tenant from tests.ids),
      '+27821110001', '+27115550100', 'Your account is overdue.', 'pending_approval', 'wamid.forged')$$,
  '42501', null, 'a new outbound message carries no delivery state');
select lives_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    values ((select nexus from tests.ids), 'whatsapp', 'outbound', 'overdue_payment_reminder', 'tenant', (select tenant from tests.ids),
      '+27821110001', '+27115550100', 'Your account is overdue. (agent draft)', 'pending_approval')$$,
  'the backend (an AI agent, next) can create a message awaiting approval');

-- ================================================================== the approval rule holds for the backend
reset role;
-- Every earlier write is checked now; then a newer request is opened on an approved message, so its
-- governing approval is pending (approvals carry no status trigger of their own).
set constraints all immediate;
insert into public.message_approvals (company_id, communication_id, requested_by_user_id)
values ((select nexus from tests.ids), tests.id('reopened_request'), (select naledi from tests.ids));
set local role service_role;
select throws_ok(
  $$select public.claim_communication((select nexus from tests.ids), tests.id('reopened_request'))$$,
  '23514', null, 'the backend cannot claim a tenant message whose governing approval is not approved');
reset role;
set constraints all deferred;

-- ================================================================== signed-in users
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok(
  $$select public.claim_communication((select nexus from tests.ids), tests.id('from_approved'))$$,
  '42501', null, 'a signed-in user cannot claim a message');
select throws_ok(
  $$select public.record_communication_provider_status((select nexus from tests.ids), 'wamid.lc-from_delivered', 'read', now())$$,
  '42501', null, 'a signed-in user cannot record a WhatsApp status');

-- decide: one transaction for the decision and the status
set constraints all immediate;
select is(public.decide_communication((select nexus from tests.ids), tests.id('from_pending_approval'),
    (select id from public.message_approvals where communication_id = tests.id('from_pending_approval')), 'approved', 'Figures checked'),
  'decided', 'decide: approve a message awaiting approval');
select ok((select c.status = 'approved' and a.decision = 'approved' and a.decided_by_user_id = (select naledi from tests.ids)
    and a.reason = 'Figures checked'
  from public.communications c join public.message_approvals a on a.communication_id = c.id
  where c.id = tests.id('from_pending_approval')), 'decide: approval and status move together; the approver is the caller');
select is(public.decide_communication((select nexus from tests.ids), tests.id('from_pending_approval'),
    (select id from public.message_approvals where communication_id = tests.id('from_pending_approval')), 'rejected'),
  'not_pending', 'decide: a decided message is not decided again');
select is(public.decide_communication((select kgalagadi from tests.ids), '90000000-0000-4000-8000-000000000005',
    (select id from public.message_approvals where communication_id = '90000000-0000-4000-8000-000000000005'), 'approved'),
  'not_found', 'decide: another company''s message is not found');

-- A decision recorded directly on the request (not through decide) is finished, not contradicted.
update public.message_approvals set decision = 'approved' where communication_id = tests.id('direct');
update public.message_approvals set decision = 'rejected' where communication_id = tests.id('contradicted');
select is(public.decide_communication((select nexus from tests.ids), tests.id('direct'),
    (select id from public.message_approvals where communication_id = tests.id('direct')), 'approved'),
  'decided', 'decide: finishes an approval recorded without its status move');
select is((select status::text from public.communications where id = tests.id('direct')), 'approved', 'decide: ... the message is approved');
select is(public.decide_communication((select nexus from tests.ids), tests.id('contradicted'),
    (select id from public.message_approvals where communication_id = tests.id('contradicted')), 'approved'),
  'approval_decided', 'decide: never approves a request that was rejected');
select is((select status::text from public.communications where id = tests.id('contradicted')), 'pending_approval',
  'decide: ... and changes nothing');
select throws_ok(
  $$select public.decide_communication((select nexus from tests.ids), tests.id('contradicted'),
      (select id from public.message_approvals where communication_id = tests.id('contradicted')), 'pending')$$,
  '22023', null, 'decide: the decision is approved or rejected');

-- stop while a send is in flight: the send that did go out is still recorded.
select lives_ok($$update public.communications set status = 'rejected' where id = tests.id('direct')$$,
  'stop: a writer stops an approved message');
reset role;
set local role service_role;
select is(public.claim_communication((select nexus from tests.ids), tests.id('direct')), null, 'stop: a stopped message is never claimed');
reset role;
set local role authenticated;
select lives_ok($$update public.communications set status = 'rejected' where id = tests.id('in_flight')$$,
  'stop: a writer stops a message while its send is in flight');
reset role;
set local role service_role;
select ok(not public.record_communication_failed((select nexus from tests.ids), tests.id('in_flight'), 'refused', false),
  'stop: a failure does not overwrite the stop');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('in_flight'), 'wamid.in-flight'), 'recorded',
  'stop: WhatsApp accepted the send, so it is recorded as sent');
select is(public.record_communication_sent((select nexus from tests.ids), tests.id('direct'), 'wamid.never-claimed'), 'not_claimed',
  'stop: a message stopped before its claim can never be recorded as sent');
reset role;
set constraints all deferred;

select * from finish();
rollback;
