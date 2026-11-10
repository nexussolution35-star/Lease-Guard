-- Audited state changes and the database-level product guards.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(38);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.uid(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email
$$;
-- Audit rows for an entity, read as the database owner (independent of the caller's RLS).
create function tests.audit(p_entity_id uuid, p_action public.audit_action) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id and action = p_action
$$;

-- Fixture ids, captured before impersonating.
create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from public.leases where reference = 'WIP-L003') as unverified_lease,
  (select id from public.leases where reference = 'DVC-L003') as other_unverified_lease,
  (select id from public.monitoring_events where status = 'new' and company_id = (select id from public.companies where initials = 'NS') order by id limit 1) as open_event,
  (select e.id from public.statement_extractions e join public.companies c on c.id = e.company_id where e.status = 'pending_review' and c.initials = 'NS') as pending_extraction,
  (select e.statement_id from public.statement_extractions e join public.companies c on c.id = e.company_id where e.status = 'pending_review' and c.initials = 'NS') as review_statement,
  (select a.id from public.message_approvals a join public.companies c on c.id = a.company_id where a.decision = 'pending' and c.initials = 'NS') as pending_approval,
  (select a.communication_id from public.message_approvals a join public.companies c on c.id = a.company_id where a.decision = 'pending' and c.initials = 'NS') as pending_message,
  (select a.communication_id from public.message_approvals a join public.companies c on c.id = a.company_id where a.decision = 'pending' and c.initials = 'KP') as kgalagadi_pending_message,
  (select id from public.tenants where company_id = (select id from public.companies where initials = 'NS') order by id limit 1) as tenant;
grant select on tests.ids to authenticated, service_role;

select isnt((select row(t.*)::text from tests.ids t), null, 'fixtures resolved');
select ok((select num_nulls(variadic array[nexus, kgalagadi, naledi, unverified_lease, other_unverified_lease, open_event,
  pending_extraction, review_statement, pending_approval, pending_message, kgalagadi_pending_message, tenant]) = 0 from tests.ids),
  'every fixture exists');

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

-- ------------------------------------------------------------------ lease verification
update public.leases set verified = true where id = (select unverified_lease from tests.ids);
select is((select verified_by_user_id from public.leases where id = (select unverified_lease from tests.ids)),
  (select naledi from tests.ids), 'verifying a lease records the signed-in user as verifier');
select is((select count(*) from tests.audit((select unverified_lease from tests.ids), 'verify')
  where actor_user_id = (select naledi from tests.ids) and changes @> '[{"field":"verified","before":false,"after":true}]'),
  1::bigint, 'lease verification writes an audit row with the actor and change');
update public.leases set verified = false where id = (select unverified_lease from tests.ids);
select is((select count(*) from tests.audit((select unverified_lease from tests.ids), 'update')), 1::bigint,
  'revoking lease verification is audited');
select is((select verified_by_user_id from public.leases where id = (select unverified_lease from tests.ids)), null,
  'revoking verification clears the verifier');

-- Unverified lease terms are not financial evidence.
select throws_ok(
  $$insert into public.monitoring_events (company_id, type, property_id, unit_id, tenant_id, lease_id, title, description,
      identified_on, priority, recommended_action)
    select l.company_id, 'deposit_shortfall', l.property_id, l.unit_id, l.tenant_id, l.id, 'x', 'x', current_date, 'low', 'x'
    from public.leases l where l.id = (select other_unverified_lease from tests.ids)$$,
  '23514', null, 'financial monitoring events require a verified lease'
);

-- ------------------------------------------------------------------ monitoring event dismissal
select throws_ok(
  $$update public.monitoring_events set status = 'dismissed' where id = (select open_event from tests.ids)$$,
  '23514', null, 'an event cannot be dismissed without a reason'
);
update public.monitoring_events set status = 'dismissed', dismissal_reason = 'Handled offline with the tenant'
where id = (select open_event from tests.ids);
select is((select dismissed_by_user_id from public.monitoring_events where id = (select open_event from tests.ids)),
  (select naledi from tests.ids), 'dismissal records the signed-in user');
select is((select count(*) from tests.audit((select open_event from tests.ids), 'dismiss')
  where actor_user_id = (select naledi from tests.ids) and summary like '%Handled offline%'),
  1::bigint, 'dismissal writes an audit row with the reason');

-- ------------------------------------------------------------------ statement extraction review and correction
update public.statement_extraction_fields set corrected_value = '12345.67'
where extraction_id = (select pending_extraction from tests.ids) and name = 'rental_charged';
select is((select corrected_by_user_id from public.statement_extraction_fields
  where extraction_id = (select pending_extraction from tests.ids) and name = 'rental_charged'),
  (select naledi from tests.ids), 'a field correction records the signed-in user');
select is((select count(*) from tests.audit((select pending_extraction from tests.ids), 'update')
  where changes @> '[{"field":"rental_charged","after":12345.67}]'),
  1::bigint, 'a field correction writes an audit row with the corrected value');
update public.statement_extractions set status = 'corrected' where id = (select pending_extraction from tests.ids);
select is((select reviewed_by_user_id from public.statement_extractions where id = (select pending_extraction from tests.ids)),
  (select naledi from tests.ids), 'extraction review records the reviewer');
select is((select count(*) from tests.audit((select pending_extraction from tests.ids), 'update')
  where changes @> '[{"field":"status","before":"pending_review","after":"corrected"}]'),
  1::bigint, 'extraction status change is audited');

-- Statements are never verified with guessed (missing) figures.
select throws_ok(
  $$update public.statements set status = 'verified' where id = (select review_statement from tests.ids)$$,
  '23514', null, 'a statement cannot be verified without its confirmed figures'
);
update public.statements set status = 'verified', opening_balance = 0, rental_charged = 12345.67,
  additional_charges = 0, payments_received = 0, closing_balance = 12345.67, total_due = 12345.67
where id = (select review_statement from tests.ids);
select is((select verified_by_user_id from public.statements where id = (select review_statement from tests.ids)),
  (select naledi from tests.ids), 'statement verification records the signed-in user');
select is((select count(*) from tests.audit((select review_statement from tests.ids), 'verify')
  where changes @> '[{"field":"rentalCharged","after":12345.67}]'),
  1::bigint, 'statement verification is audited with the confirmed figures');
update public.statements set rental_charged = 12000, closing_balance = 12000, total_due = 12000
where id = (select review_statement from tests.ids);
select is((select count(*) from tests.audit((select review_statement from tests.ids), 'update')
  where changes @> '[{"field":"rentalCharged","before":12345.67,"after":12000}]'),
  1::bigint, 'statement figure corrections are audited');

-- ------------------------------------------------------------------ tenant message approval
-- Delivery states (queued, sent) are recorded by the delivery worker (service role) since
-- 20261109101600, through the communication lifecycle's transition table since 20261110100300.
set constraints all immediate;
reset role;
set local role service_role;
select throws_ok(
  $$update public.communications set status = 'queued' where id = (select pending_message from tests.ids)$$,
  '42501', null, 'a tenant message cannot be queued while it awaits approval (not a lifecycle transition)'
);
reset role;
set local role authenticated;
update public.message_approvals set decision = 'approved' where id = (select pending_approval from tests.ids);
select is((select decided_by_user_id from public.message_approvals where id = (select pending_approval from tests.ids)),
  (select naledi from tests.ids), 'approval decision records the approver');
select is((select count(*) from tests.audit((select pending_approval from tests.ids), 'approve')
  where actor_user_id = (select naledi from tests.ids)), 1::bigint, 'approval decision is audited');
update public.communications set status = 'approved' where id = (select pending_message from tests.ids);
reset role;
set local role service_role;
select isnt(
  public.claim_communication((select nexus from tests.ids), (select pending_message from tests.ids)), null,
  'an approved tenant message can be claimed for sending (queued)'
);
select throws_ok(
  $$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    select company_id, 'whatsapp', 'outbound', 'monthly_statement', 'tenant', id, whatsapp_number, '+27115550100', 'Statement attached.', 'sent'
    from public.tenants where id = (select tenant from tests.ids)$$,
  '42501', null, 'the backend cannot create a message as already sent'
);
reset role;
set local role authenticated;
set constraints all deferred;

-- Tenants only ever receive the five statement and payment message types.
select throws_ok(
  format($$insert into public.communications (company_id, channel, direction, message_type, recipient_type, tenant_id,
      counterparty_number, company_number, body, status)
    select company_id, 'whatsapp', 'outbound', %L, 'tenant', id, whatsapp_number, '+27115550100', 'x', 'draft'
    from public.tenants where id = (select tenant from tests.ids)$$, t),
  '23514', null, format('tenants cannot receive %s messages', t)
) from unnest(array['manual', 'owner_weekly_summary', 'owner_query_response']) t;
select throws_ok(
  $$insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body)
    values ((select nexus from tests.ids), 'Lease renewal', 'manual', 'tenant', 'renewal_v1', 'en', 'utility', 'Your lease expires soon')$$,
  '23514', null, 'tenant templates are limited to tenant message types'
);

-- ------------------------------------------------------------------ audit log is append-only
select lives_ok(
  $$insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, summary, occurred_at)
    values ((select nexus from tests.ids), (select naledi from tests.ids), 'login', 'user', (select naledi from tests.ids), 'Signed in', '2025-01-01')$$,
  'members can record their own sign-in'
);
select is(
  (select count(*) from tests.audit((select naledi from tests.ids), 'login') where occurred_at = now()),
  1::bigint, 'a client-recorded entry is stamped with the time of the insert, never back-dated');
select throws_ok(
  $$insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, summary)
    values ((select nexus from tests.ids), (select naledi from tests.ids), 'verify', 'lease', (select unverified_lease from tests.ids), 'Lease terms verified')$$,
  '42501', null, 'members cannot record business actions, which only the system writes'
);
select throws_ok(
  $$insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, summary)
    values ((select nexus from tests.ids), (select naledi from tests.ids), 'workspace_switch', 'lease', (select unverified_lease from tests.ids), 'x')$$,
  '42501', null, 'a session entry is about the user or the workspace company only'
);
select throws_ok(
  $$insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, summary)
    values ((select nexus from tests.ids), (select id from public.profiles where email like 'thandi%'), 'approve', 'company', (select nexus from tests.ids), 'forged')$$,
  '42501', null, 'audit entries cannot be written in another user''s name'
);
select throws_ok($$update public.audit_logs set summary = 'edited'$$, '42501', null, 'audit entries cannot be updated through the API');
select throws_ok($$delete from public.audit_logs$$, '42501', null, 'audit entries cannot be deleted through the API');

-- ------------------------------------------------------------------ guards that hold for the backend too
reset role;
set constraints all immediate;
select throws_ok(
  $$update public.communications set status = 'sent' where id = (select kgalagadi_pending_message from tests.ids)$$,
  '23514', null, 'the approval guard also applies to the service role'
);
select hasnt_column(
  'public', 'companies', 'require_approval_for_tenant_messages',
  'no company can switch off tenant-message approval: there is no setting (20261110100200)'
);
set constraints all deferred;
select throws_ok($$update public.audit_logs set summary = 'edited'$$, '42501', null, 'audit entries are immutable even for the owner role');
select throws_ok(
  $$insert into public.statement_extraction_fields (company_id, extraction_id, name, raw_text, value, confidence, flagged)
    select company_id, id, 'total_due', '', 'null', 0, false from public.statement_extractions
    where id = (select pending_extraction from tests.ids)
    on conflict do nothing$$,
  '23514', null, 'a missing extracted value must be flagged for review, never silently accepted'
);

select * from finish();
rollback;
