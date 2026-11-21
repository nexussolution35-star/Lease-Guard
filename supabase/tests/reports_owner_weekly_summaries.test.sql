-- The weekly owner summary (ticket R-07): the reports service's stored summaries and reporting functions
-- (20261122100100_reports_owner_weekly_summaries.sql) and the core messaging pipeline's record of the message
-- (20261122100000_owner_weekly_summary_messages.sql). Owners only, once per owner and week, never without an approved
-- template and a connected number, approved by the schedule only for an owner summary, company admins read the stored
-- summaries, the reports worker (service role) reads every company it names.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(34);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;

-- Company NS: Pieter (…005) owns Maponya Square; NS has a connected number. An approved owner template is chosen.
insert into public.message_templates (id, company_id, name, message_type, audience, meta_template_name, language, category, body, variables, approval_status)
values ('98000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner weekly', 'owner_weekly_summary', 'property_owner',
        'owner_weekly', 'en_ZA', 'utility', 'Hi {{1}}, week of {{2}}: {{3}}', '{Owner name,Week,Summary}', 'approved');
insert into public.message_type_templates (company_id, message_type, message_template_id)
values ('20000000-0000-4000-8000-000000000001', 'owner_weekly_summary', '98000000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------------ grants and conventions
select ok(not has_function_privilege('anon', 'public.reports_owner_summary_owners(uuid)', 'EXECUTE'), 'anon may not read the owners');
select ok(not has_function_privilege('authenticated', 'public.reports_owner_summary_message(uuid, uuid)', 'EXECUTE'), 'signed-in users may not read the hand-over function');
select ok(not has_function_privilege('authenticated', 'public.reports_owner_summary_companies()', 'EXECUTE'), 'nor the dispatch list');
select ok(not has_function_privilege('authenticated', 'public.record_owner_weekly_summary_message(uuid, uuid, date, text)', 'EXECUTE'),
  'signed-in users may not record an owner summary message');
select ok(has_function_privilege('service_role', 'public.reports_arrears_detail(uuid)', 'EXECUTE'), 'the reports worker reads the arrears');
select ok(not has_column_privilege('authenticated', 'public.communications', 'owner_summary_week', 'INSERT')
  and not has_column_privilege('authenticated', 'public.communications', 'owner_summary_week', 'UPDATE'),
  'signed-in users cannot set the week of an owner summary');
select ok(not has_column_privilege('authenticated', 'public.message_approvals', 'approved_by_schedule', 'INSERT')
  and not has_column_privilege('authenticated', 'public.message_approvals', 'approved_by_schedule', 'UPDATE'),
  'signed-in users cannot approve by the schedule');
select ok(not has_table_privilege('authenticated', 'public.reports_owner_summaries', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reports_owner_summaries', 'UPDATE'), 'only the reports worker writes stored summaries');

-- ------------------------------------------------------------------ reading as a company admin
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);

select results_eq(
  $$select owner_user_id, owner_name, owner_status::text, owner_role::text, whatsapp_number, properties -> 0 ->> 'propertyName'
    from public.reports_owner_summary_owners('20000000-0000-4000-8000-000000000001')$$,
  $$select '10000000-0000-4000-8000-000000000005'::uuid, p.full_name, 'active'::text, 'property_owner'::text, '+27825501194'::text, 'Maponya Square'::text
    from public.profiles p where p.id = '10000000-0000-4000-8000-000000000005'$$,
  'the owners of the company''s properties with their role, number and properties');
select results_eq(
  $$select owner_summary_weekday::text, whatsapp_connected, meta_template_name, approval_status::text, body
    from public.reports_owner_summary_channel('20000000-0000-4000-8000-000000000001')$$,
  $$values ('monday'::text, true, 'owner_weekly'::text, 'approved'::text, 'Hi {{1}}, week of {{2}}: {{3}}'::text)$$,
  'the company''s day, its connected number and the template chosen for owner summaries');
select throws_ok($$select * from public.reports_owner_summary_owners('20000000-0000-4000-8000-000000000002')$$, '42501', null,
  'another company is refused');

-- ------------------------------------------------------------------ the reports worker
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok((select count(*) from public.reports_owner_summary_companies() where company_id = '20000000-0000-4000-8000-000000000001') = 1,
  'the dispatch lists the active companies');
select is((select count(*)::int from public.reports_arrears_detail('20000000-0000-4000-8000-000000000002')), 1,
  'the worker reads any company it names, through the same reporting functions');
select throws_ok($$select private.reports_require_member(null)$$, '42501', null, 'but must name one');

select throws_ok($$insert into public.reports_owner_summaries (company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-16', '2026-11-16', 0, '{}', '{a,b,c}', 'handed_over')$$,
  '23514', null, 'a summary handed over records when');
insert into public.reports_owner_summaries (id, company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status, handed_over_at)
values ('99000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
        '2026-11-16', '2026-11-16', 13000, '{"totalOutstanding": 13000}', array['Pieter', '16 Nov 2026', 'Outstanding R 13 000,00'], 'handed_over', now());
insert into public.reports_owner_summaries (id, company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status, handed_over_at)
values ('99000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006',
        '2026-11-16', '2026-11-16', 0, '{}', array['Zanele', '16 Nov 2026', 'Outstanding R 0,00'], 'handed_over', now());
select throws_ok($$update public.reports_owner_summaries set total_outstanding = 1 where id = '99000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'a summary handed over is final');
select throws_ok($$insert into public.reports_owner_summaries (company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-17', '2026-11-17', 0, '{}', '{a,b,c}', 'ready')$$,
  '23514', null, 'a week starts on a Monday');
select throws_ok($$insert into public.reports_owner_summaries (company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-23', '2026-11-23', 0, '{}', '{a,b,c}', 'blocked')$$,
  '23514', null, 'a blocked summary says why');
insert into public.reports_owner_summaries (id, company_id, owner_user_id, week_start, as_of, total_outstanding, summary, template_values, status)
values ('99000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
        '2026-11-23', '2026-11-23', 15000, '{"totalOutstanding": 15000}', array['Pieter', '23 Nov 2026', 'Outstanding R 15 000,00'], 'ready');

select results_eq(
  $$select owner_user_id, week_start, template_values from public.reports_owner_summary_message('20000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003')$$,
  $$values ('10000000-0000-4000-8000-000000000005'::uuid, '2026-11-23'::date, array['Pieter', '23 Nov 2026', 'Outstanding R 15 000,00'])$$,
  'the core worker reads the stored summary it sends');

-- ------------------------------------------------------------------ the core records the message
select results_eq(
  $$select outcome, reason from public.record_owner_weekly_summary_message('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '2026-11-23', 'Hi Naledi')$$,
  $$values ('blocked'::text, 'User is not a property owner in this company'::text)$$,
  'owners only: a property manager is never sent an owner summary');
select results_eq(
  $$select outcome, reason from public.record_owner_weekly_summary_message('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007', '2026-11-23', 'Hi Lerato')$$,
  $$values ('blocked'::text, 'No WhatsApp template approved by Meta is chosen for the weekly owner summary'::text)$$,
  'nothing is sent without an approved template');
select throws_ok($$select * from public.record_owner_weekly_summary_message('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-24', 'x')$$,
  '22023', null, 'the week is named by its Monday');

select results_eq(
  $$select outcome from public.record_owner_weekly_summary_message('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-23',
      'Hi Pieter, week of 23 Nov 2026: Outstanding R 15 000,00')$$,
  $$values ('created'::text)$$,
  'an eligible owner''s summary is recorded');
select results_eq(
  $$select c.message_type::text, c.recipient_type::text, c.status::text, c.counterparty_number, c.company_number, c.template_id, c.tenant_id
    from public.communications c where c.owner_summary_week = '2026-11-23' and c.owner_user_id = '10000000-0000-4000-8000-000000000005'$$,
  $$values ('owner_weekly_summary'::text, 'property_owner'::text, 'approved'::text, '+27825501194'::text, '+27 11 555 0100'::text,
            '98000000-0000-4000-8000-000000000001'::uuid, null::uuid)$$,
  'as an approved owner_weekly_summary to the owner''s number, from the company''s own number, with its template');
select results_eq(
  $$select a.decision::text, a.approved_by_schedule, a.decided_by_user_id, a.decided_at is not null
    from public.message_approvals a join public.communications c on c.company_id = a.company_id and c.id = a.communication_id
    where c.owner_summary_week = '2026-11-23'$$,
  $$values ('approved'::text, true, null::uuid, true)$$,
  'approved by the schedule, not by a person');
select results_eq(
  $$select outcome, communication_id = (select id from public.communications where owner_summary_week = '2026-11-23')
    from public.record_owner_weekly_summary_message('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '2026-11-23', 'Hi again')$$,
  $$values ('existing'::text, true)$$,
  'once per owner and week: a repeat returns the message already recorded');
select is((select count(*)::int from public.communications where owner_summary_week = '2026-11-23'), 1, 'and creates no second message');

select throws_ok($$insert into public.message_approvals (company_id, communication_id, decision, decided_at, approved_by_schedule)
  select company_id, id, 'approved', now(), true from public.communications
  where company_id = '20000000-0000-4000-8000-000000000001' and recipient_type = 'tenant' limit 1$$,
  '42501', null, 'the schedule never approves a tenant message');
select throws_ok($$update public.communications set status = 'approved'
  where company_id = '20000000-0000-4000-8000-000000000001' and status = 'pending_approval'$$,
  '42501', null, 'the backend approves only through the lifecycle');

-- Deliveries go through the lifecycle as for every other message.
select results_eq(
  $$select c.status::text from public.communications c where c.owner_summary_week = '2026-11-23'$$,
  $$values ('approved'::text)$$,
  'ready for the message-delivery queue');

-- ------------------------------------------------------------------ the admin sees the week and its delivery
reset role;
set local role authenticated;
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
select results_eq(
  $$select status, delivery_status::text, previous_week_start, previous_total_outstanding
    from public.reports_owner_summaries_stored('20000000-0000-4000-8000-000000000001', '2026-11-23')
    where owner_user_id = '10000000-0000-4000-8000-000000000005'$$,
  $$values ('ready'::text, 'approved'::text, '2026-11-16'::date, 13000.00::numeric)$$,
  'the week''s summary, its message''s delivery status and the previous week''s total');

select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select is((select count(*)::int from public.reports_owner_summaries), 0, 'a property manager does not read the stored summaries');
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is((select count(*)::int from public.reports_owner_summaries), 0, 'nor does another company');
select throws_ok($$select * from public.reports_owner_summaries_stored('20000000-0000-4000-8000-000000000001', '2026-11-23')$$, '42501', null,
  'another company''s week is refused');

select * from finish();
rollback;
