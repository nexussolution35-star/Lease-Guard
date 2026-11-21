-- Recording, editing, closing and cancelling payment arrangements (ticket M7-03): writers go through the functions, the
-- schedule is generated from the terms, the terms are checked in words, one active arrangement per tenant, instalment
-- outcomes recorded by a manager, closed arrangements read-only, every change audited, grants, roles and companies.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction (Dlamini Cellular already has
-- an active arrangement on MSQ-L001).
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(63);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.arrangement(p_id uuid) returns public.payment_arrangements
language sql security definer set search_path = '' as $$
  select * from public.payment_arrangements where id = p_id
$$;
create function tests.schedule(p_id uuid) returns text
language sql security definer set search_path = '' as $$
  select string_agg(format('%s %s %s %s', sequence, due_date, amount, status), '; ' order by sequence)
  from public.arrangement_installments where arrangement_id = p_id
$$;
create function tests.installment(p_id uuid, p_sequence integer) returns public.arrangement_installments
language sql security definer set search_path = '' as $$
  select * from public.arrangement_installments where arrangement_id = p_id and sequence = p_sequence
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_type = 'payment_arrangement' and entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.today() returns date
language sql stable security definer set search_path = '' as $$ select private.sa_today() $$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from public.properties where code = 'MSQ') as msq,
  (select id from public.tenants where trading_name = 'Dlamini Cellular') as dlamini,
  (select id from public.tenants where trading_name = 'Kasi Flame Grill') as kasi,
  (select id from public.tenants where trading_name = 'Fresh Mart') as fresh_mart,
  (select id from public.tenants where trading_name = 'Arcadia Books') as arcadia,
  (select id from public.leases where reference = 'WIP-L003') as kasi_lease,
  (select id from public.leases where reference = 'DVC-L003') as fresh_mart_lease,
  (select id from public.leases where reference = 'MSQ-L001') as dlamini_lease,
  (select id from public.payment_arrangements where tenant_id = '50000000-0000-4000-8000-000000000001') as dlamini_active,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;
grant select on tests.ids to authenticated, service_role;
create table tests.made (name text primary key, id uuid);
grant select, insert on tests.made to authenticated, service_role;
select ok(
  (select num_nulls(nexus, kgalagadi, msq, dlamini, kasi, fresh_mart, arcadia, kasi_lease, fresh_mart_lease, dlamini_lease, dlamini_active, naledi) = 0 from tests.ids),
  'every fixture exists'
);
create table tests.counts as select
  (select count(*) from public.communications) as communications,
  (select count(*) from public.monitoring_events) as events;

-- ------------------------------------------------------------------ the schedule
select is(
  (select string_agg(format('%s %s %s', sequence, due_date, amount), '; ' order by sequence)
   from private.arrangement_schedule(10000, 3000, 'monthly', '2026-01-31')),
  '1 2026-01-31 3000; 2 2026-02-28 3000; 3 2026-03-31 3000; 4 2026-04-30 1000',
  'monthly keeps the day of the month, clamped to the month end, and the last instalment is the remainder'
);
select is(
  (select string_agg(format('%s %s', sequence, due_date), '; ' order by sequence)
   from private.arrangement_schedule(300, 100, 'fortnightly', '2026-11-02')),
  '1 2026-11-02; 2 2026-11-16; 3 2026-11-30', 'fortnightly adds 14 days'
);
select is(
  (select string_agg(format('%s %s', sequence, due_date), '; ' order by sequence)
   from private.arrangement_schedule(150, 100, 'weekly', '2026-11-02')),
  '1 2026-11-02; 2 2026-11-09', 'weekly adds 7 days'
);

create function tests.kasi() returns uuid language sql security definer set search_path = '' as $$
  select id from tests.made where name = 'kasi'
$$;

-- ------------------------------------------------------------------ a property manager records
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

insert into tests.made
select 'kasi', public.record_payment_arrangement(
  p_company_id => nexus, p_tenant_id => kasi, p_property_id => msq, p_lease_id => kasi_lease,
  p_outstanding_balance => 10000, p_installment_amount => 3000, p_frequency => 'monthly',
  p_first_installment_date => '2026-01-31', p_agreed_on => '2026-01-15', p_notes => '  Agreed by phone  '
) from tests.ids;

select is((tests.arrangement(tests.kasi())).status::text, 'active', 'a new arrangement is active by default');
select is((tests.arrangement(tests.kasi())).final_installment_date, '2026-04-30'::date, 'the final date follows the schedule');
select is((tests.arrangement(tests.kasi())).unit_id, (select unit_id from public.leases where reference = 'WIP-L003'), 'the unit is the lease''s');
select is((tests.arrangement(tests.kasi())).agreed_by_user_id, (select naledi from tests.ids), 'who recorded it is stamped');
select is((tests.arrangement(tests.kasi())).notes, 'Agreed by phone', 'notes are trimmed');
select ok((tests.arrangement(tests.kasi())).suppress_arrears_reminders, 'it suppresses normal arrears reminders');
select is(
  tests.schedule(tests.kasi()),
  '1 2026-01-31 3000.00 scheduled; 2 2026-02-28 3000.00 scheduled; 3 2026-03-31 3000.00 scheduled; 4 2026-04-30 1000.00 scheduled',
  'the instalments are generated from the terms'
);
select is(
  (select summary from tests.audit(tests.kasi()) where action = 'create'),
  'Payment arrangement recorded for Kasi Flame Grill under lease WIP-L003', 'recording is audited'
);
select is((select actor_user_id from tests.audit(tests.kasi()) where action = 'create'), (select naledi from tests.ids), 'by the signed-in user');

-- The lease is resolved when it is not given.
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => kasi, p_property_id => msq,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  '22023', 'Kasi Flame Grill has no lease in force at Maponya Square. Choose the lease the arrears are under.',
  'a tenant without a lease in force must name the lease'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => dlamini, p_property_id => msq,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  'P0001', 'Dlamini Cellular already has an active payment arrangement (agreed on 01 Nov 2026). Close or cancel it first.',
  'one active arrangement per tenant, in words'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => kasi, p_property_id => msq, p_lease_id => dlamini_lease,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  '22023', 'Lease MSQ-L001 is not a lease of Kasi Flame Grill at Maponya Square.',
  'the lease must be the tenant''s at the property'
);
insert into tests.made
select 'dlamini_proposal', public.record_payment_arrangement(
  p_company_id => nexus, p_tenant_id => dlamini, p_property_id => msq, p_status => 'proposed',
  p_outstanding_balance => 600, p_installment_amount => 200, p_frequency => 'weekly', p_first_installment_date => tests.today() + 7
) from tests.ids;
select is(
  (select lease_id from public.payment_arrangements where id = (select id from tests.made where name = 'dlamini_proposal')),
  (select dlamini_lease from tests.ids), 'a proposal next to an active arrangement takes the tenant''s single lease in force'
);
select is(
  (select agreed_on from public.payment_arrangements where id = (select id from tests.made where name = 'dlamini_proposal')),
  tests.today(), 'the agreement date defaults to today'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), (select id from tests.made where name = 'dlamini_proposal'), p_status => 'active')$$,
  'P0001', 'Dlamini Cellular already has an active payment arrangement (agreed on 01 Nov 2026). Close or cancel it first.',
  'a proposal cannot become active beside the active one'
);

-- The terms, in words.
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 10000, p_installment_amount => 3000, p_frequency => 'monthly', p_first_installment_date => '2026-01-31',
      p_final_installment_date => '2026-03-31', p_agreed_on => '2026-01-01') from tests.ids$$,
  '22023', 'The final instalment of this schedule is due on 30 Apr 2026 (4 instalments), not 31 Mar 2026.',
  'a final date that disagrees with the schedule is refused'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 100, p_installment_amount => 200, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  '22023', 'The instalment amount cannot be more than the outstanding balance.', 'an instalment larger than the balance is refused'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 100, p_installment_amount => 0, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  '22023', 'The instalment amount must be more than R 0,00.', 'a zero instalment is refused'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-01-01',
      p_agreed_on => '2026-02-01') from tests.ids$$,
  '22023', 'The first instalment cannot be before the agreement date (01 Feb 2026).', 'the first instalment is on or after the agreement'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => tests.today() + 30,
      p_agreed_on => tests.today() + 1) from tests.ids$$,
  '22023', 'The agreement date cannot be in the future.', 'an agreement in the future is refused'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 1000, p_installment_amount => 3, p_frequency => 'weekly', p_first_installment_date => '2026-12-01',
      p_agreed_on => '2026-11-01') from tests.ids$$,
  '22023', 'This schedule has 334 instalments; at most 260 are allowed. Raise the instalment amount.', 'at most 260 instalments'
);
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-12-01',
      p_status => 'completed') from tests.ids$$,
  '22023', 'A new arrangement is proposed or active.', 'a new arrangement is not closed'
);

-- ------------------------------------------------------------------ editing
select lives_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_installment_amount => 5000)$$,
  'a writer changes the instalment amount'
);
select is(tests.schedule(tests.kasi()), '1 2026-01-31 5000.00 scheduled; 2 2026-02-28 5000.00 scheduled', 'the schedule is generated again');
select is((tests.arrangement(tests.kasi())).final_installment_date, '2026-02-28'::date, 'and the final date follows it');
select is(
  (select changes from tests.audit(tests.kasi()) where summary = 'Payment arrangement for Kasi Flame Grill updated'),
  '[{"after": 5000, "field": "installment_amount", "before": 3000.00}, {"after": "2026-02-28", "field": "final_installment_date", "before": "2026-04-30"}]'::jsonb,
  'the edit is audited with the changed fields'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_final_installment_date => '2026-05-31')$$,
  '22023', 'The final instalment of this schedule is due on 28 Feb 2026 (2 instalments), not 31 May 2026.', 'an edited final date must agree'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_status => 'completed')$$,
  '22023', 'Close or cancel the arrangement to end it.', 'editing does not close'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_status => 'proposed')$$,
  'P0001', 'An arrangement that is active cannot become proposed.', 'an active arrangement does not go back to proposed'
);

-- ------------------------------------------------------------------ instalment outcomes (manager confirmation)
select lives_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), tests.kasi(), (tests.installment(tests.kasi(), 1)).id, 'confirmed_paid', 'Seen on the statement')$$,
  'a writer records an instalment as paid'
);
select is((tests.installment(tests.kasi(), 1)).confirmed_by_user_id, (select naledi from tests.ids), 'who confirmed it is stamped');
select is((tests.installment(tests.kasi(), 1)).confirmed_on, tests.today(), 'and when');
select is((tests.installment(tests.kasi(), 1)).outcome_recorded_by_user_id, (select naledi from tests.ids), 'who recorded the outcome is stamped');
select lives_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), tests.kasi(), (tests.installment(tests.kasi(), 2)).id, 'missed')$$,
  'a past instalment is recorded as missed'
);
select is(
  (select summary from tests.audit(tests.kasi()) where summary like 'Instalment 2%'),
  'Instalment 2 of 2 (due 28 Feb 2026) recorded as missed', 'the outcome is audited on the arrangement'
);
select lives_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), tests.kasi(), (tests.installment(tests.kasi(), 2)).id, 'scheduled')$$,
  'a recorded outcome can be cleared'
);
select is(
  ((tests.installment(tests.kasi(), 2)).status::text, (tests.installment(tests.kasi(), 2)).outcome_recorded_by_user_id),
  ('scheduled'::text, null::uuid), 'clearing removes the outcome and who recorded it'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_installment_amount => 2500)$$,
  'P0001', 'Instalment outcomes are already recorded, so the schedule is fixed. Cancel this arrangement and record a new one.',
  'the schedule is fixed once an outcome is recorded'
);
select lives_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_notes => 'Paid the first one in cash at the office')$$,
  'the notes stay editable'
);
select throws_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), tests.kasi(), (tests.installment(tests.kasi(), 1)).id, 'reminder_sent')$$,
  '22023', 'An instalment is recorded as paid, missed or waived, or cleared.', 'a reminder is not an outcome'
);

insert into tests.made
select 'fresh_mart', public.record_payment_arrangement(
  p_company_id => nexus, p_tenant_id => fresh_mart, p_property_id => msq, p_lease_id => fresh_mart_lease,
  p_outstanding_balance => 1000, p_installment_amount => 500, p_frequency => 'monthly', p_first_installment_date => tests.today() + 10
) from tests.ids;
select throws_ok(
  format($$select public.record_arrangement_installment_outcome((select nexus from tests.ids), %L, (tests.installment(%L, 1)).id, 'missed')$$,
    (select id from tests.made where name = 'fresh_mart'), (select id from tests.made where name = 'fresh_mart')),
  'P0001', format('Instalment 1 is due on %s, so it cannot be missed yet.', to_char(tests.today() + 10, 'DD Mon YYYY')),
  'a future instalment cannot be missed'
);

-- ------------------------------------------------------------------ close and cancel
select throws_ok(
  format($$select public.close_payment_arrangement((select nexus from tests.ids), %L, 'cancelled')$$, (select id from tests.made where name = 'fresh_mart')),
  '22023', 'Give the reason for cancelling the arrangement.', 'cancelling needs a reason'
);
select lives_ok(
  format($$select public.close_payment_arrangement((select nexus from tests.ids), %L, 'cancelled', 'Tenant paid in full')$$, (select id from tests.made where name = 'fresh_mart')),
  'a writer cancels an arrangement with a reason'
);
select is(
  ((tests.arrangement((select id from tests.made where name = 'fresh_mart'))).closed_on, (tests.arrangement((select id from tests.made where name = 'fresh_mart'))).closed_by_user_id,
   (tests.arrangement((select id from tests.made where name = 'fresh_mart'))).close_reason),
  (tests.today(), (select naledi from tests.ids), 'Tenant paid in full'::text), 'cancelling stamps when, who and why'
);
select is(
  (select summary from tests.audit((select id from tests.made where name = 'fresh_mart')) where action = 'update'),
  'Payment arrangement for Fresh Mart cancelled', 'cancelling is audited'
);
select throws_ok(
  $$select public.close_payment_arrangement((select nexus from tests.ids), (select id from tests.made where name = 'dlamini_proposal'), 'completed')$$,
  'P0001', 'A proposed arrangement was never active, so it can only be cancelled.', 'a proposal can only be cancelled'
);
select lives_ok(
  $$select public.close_payment_arrangement((select nexus from tests.ids), tests.kasi(), 'defaulted', 'Stopped paying')$$,
  'a writer closes an active arrangement as defaulted'
);
select throws_ok(
  $$select public.update_payment_arrangement((select nexus from tests.ids), tests.kasi(), p_notes => 'late note')$$,
  'P0001', 'This arrangement is defaulted and can no longer change.', 'a closed arrangement is read-only'
);
select throws_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), tests.kasi(), (tests.installment(tests.kasi(), 2)).id, 'waived')$$,
  'P0001', 'Instalment outcomes are recorded while the arrangement is active; this one is defaulted.', 'nor are its instalments recorded'
);

-- ------------------------------------------------------------------ roles, companies and direct writes
select throws_ok(
  $$select public.record_payment_arrangement(p_company_id => nexus, p_tenant_id => arcadia, p_property_id => msq,
      p_outstanding_balance => 100, p_installment_amount => 50, p_frequency => 'monthly', p_first_installment_date => '2026-12-01') from tests.ids$$,
  'P0002', 'The tenant is not in this workspace', 'another company''s tenant is not found'
);
select throws_ok(
  $$select public.close_payment_arrangement((select kgalagadi from tests.ids), tests.kasi(), 'completed')$$,
  '42501', null, 'a writer of one company cannot write another''s'
);
select throws_ok(
  $$insert into public.payment_arrangements (company_id, tenant_id, property_id, unit_id, lease_id, outstanding_balance, installment_amount,
      frequency, first_installment_date, final_installment_date, agreed_by_user_id, agreed_on)
    select nexus, fresh_mart, msq, (select unit_id from public.leases where id = fresh_mart_lease), fresh_mart_lease, 100, 50, 'monthly',
      '2026-12-01', '2027-01-01', naledi, '2026-11-01' from tests.ids$$,
  '42501', null, 'signed-in users do not insert arrangements directly'
);
select throws_ok(
  $$update public.arrangement_installments set status = 'confirmed_paid' where arrangement_id = (select dlamini_active from tests.ids)$$,
  '42501', null, 'nor update instalments directly'
);

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.close_payment_arrangement((select nexus from tests.ids), (select dlamini_active from tests.ids), 'completed')$$,
  '42501', null, 'a read-only member cannot close an arrangement'
);
select is((select count(*)::integer from public.payment_arrangements where tenant_id = (select kasi from tests.ids)), 1, 'but reads it');
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$select public.record_arrangement_installment_outcome((select nexus from tests.ids), (select dlamini_active from tests.ids),
      (tests.installment((select dlamini_active from tests.ids), 1)).id, 'confirmed_paid')$$,
  '42501', null, 'a property owner cannot record outcomes'
);

-- ------------------------------------------------------------------ the guard applies to every role
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$update public.payment_arrangements set tenant_id = (select kasi from tests.ids) where id = (select dlamini_active from tests.ids)$$,
  'P0001', 'An arrangement''s tenant, property, unit, lease and who agreed it are fixed. Cancel it and record a new one.',
  'the parties are fixed'
);
select throws_ok(
  $$update public.payment_arrangements set status = 'active' where id = tests.kasi()$$,
  'P0001', 'This arrangement is defaulted and can no longer change.', 'a closed arrangement stays closed'
);
select ok(
  (select communications = (select count(*) from public.communications) and events = (select count(*) from public.monitoring_events) from tests.counts),
  'recording, editing and closing arrangements write no communication or monitoring event'
);

select * from finish();
rollback;
