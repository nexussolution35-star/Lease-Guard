-- The tenant-messaging rules the database owns as the last line of defence, checked against their
-- TypeScript owners:
--   * private.is_tenant_message_type (CHECK constraints on communications and message_templates)
--     accepts exactly TENANT_MESSAGE_TYPES of @leaseguard/domain. The parity test
--     backend/src/infrastructure/database/enum-parity.test.ts reads the list between the markers below
--     and compares it with the domain tuple, so SQL and TypeScript are checked against one list;
--   * every outbound tenant message needs an approved approval, in every company, with no setting
--     that relaxes it (20261110100200_tenant_message_approval_always_required).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(6);

create schema tests;
-- ================================================================== tenant message type parity
-- Keep one message type per line in the form ('<message_type>'),
create table tests.tenant_message_types (message_type public.message_type primary key);
-- tenant-message-types:begin
insert into tests.tenant_message_types values
  ('monthly_statement'),
  ('initial_payment_reminder'),
  ('overdue_payment_reminder'),
  ('follow_up_payment_reminder'),
  ('arrangement_installment_reminder');
-- tenant-message-types:end

select is(
  (select array_agg(t order by t) from unnest(enum_range(null::public.message_type)) t
   where private.is_tenant_message_type(t)),
  (select array_agg(message_type order by message_type) from tests.tenant_message_types),
  'private.is_tenant_message_type accepts exactly the tenant message types');

select throws_ok(
  $$insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body)
    values ('20000000-0000-4000-8000-000000000001', 'Escalation', 'owner_weekly_summary', 'tenant', 'escalation_notice', 'en', 'utility', 'Your rent escalates.')$$,
  '23514', null, 'a tenant template for a non-tenant message type is refused');

-- ================================================================== approval always required
select hasnt_column('public', 'companies', 'require_approval_for_tenant_messages', 'there is no company switch for tenant-message approval');

set constraints all immediate;
-- Both fixture companies, as the service role would write it: no company is exempt.
select throws_ok(
  $$update public.communications set status = 'approved' where id = '90000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'Nexus: a tenant message cannot be approved while its approval request is pending');
select throws_ok(
  $$update public.communications set status = 'sent' where id = '90000000-0000-4000-8000-000000000005'$$,
  '23514', null, 'Kgalagadi: a tenant message cannot be sent while its approval request is pending');

update public.message_approvals
   set decision = 'approved', decided_by_user_id = requested_by_user_id, decided_at = now()
 where communication_id = '90000000-0000-4000-8000-000000000001';
select lives_ok(
  $$update public.communications set status = 'approved' where id = '90000000-0000-4000-8000-000000000001'$$,
  'an approved approval releases the tenant message');
set constraints all deferred;

select * from finish();
rollback;
