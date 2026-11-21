-- Settings → Message templates (ticket SG-01): company admins choose the Meta template of each message type through
-- set_message_type_template; the mapping rules, the content guard on message_templates, the audit, the grants, roles
-- and companies; the sync keeps Meta's text and header format.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(50);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- The synced Meta template of Nexus Solution with this name.
create function tests.meta(p_name text) returns uuid
language sql security definer set search_path = '' as $$
  select id from public.whatsapp_message_templates
  where company_id = '20000000-0000-4000-8000-000000000001' and name = p_name
$$;
create function tests.mapped(p_type public.message_type) returns public.message_templates
language sql security definer set search_path = '' as $$
  select m.* from public.message_type_templates mt
  join public.message_templates m on m.company_id = mt.company_id and m.id = mt.message_template_id
  where mt.company_id = '20000000-0000-4000-8000-000000000001' and mt.message_type = p_type
$$;
create function tests.mapping(p_type public.message_type) returns public.message_type_templates
language sql security definer set search_path = '' as $$
  select * from public.message_type_templates
  where company_id = '20000000-0000-4000-8000-000000000001' and message_type = p_type
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.choose(p_type public.message_type, p_name text) returns uuid
language sql set search_path = '' as $$
  select public.set_message_type_template('20000000-0000-4000-8000-000000000001', p_type, tests.meta(p_name))
$$;
grant execute on all functions in schema tests to authenticated;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '20000000-0000-4000-8000-000000000002'::uuid as kgalagadi,
  (select id from auth.users where email = 'thandi.mokoena@nexussolution.co.za') as thandi;
grant select on tests.ids to authenticated, service_role;

-- ------------------------------------------------------------------ grants
select has_table('public', 'message_type_templates', 'the mapping table exists');
select ok(not has_table_privilege('authenticated', 'public.message_type_templates', 'insert, update, delete'),
  'signed-in users never write mappings directly');
select ok(not has_table_privilege('authenticated', 'public.message_templates', 'insert, update, delete'),
  'signed-in users no longer write message templates directly');
select ok(has_table_privilege('authenticated', 'public.message_type_templates', 'select'), 'members read mappings');
select ok(has_function_privilege('authenticated', 'public.set_message_type_template(uuid, public.message_type, uuid, text[])', 'execute'),
  'signed-in users may call set_message_type_template (it checks the role)');
select ok(not has_function_privilege('anon', 'public.set_message_type_template(uuid, public.message_type, uuid, text[])', 'execute'),
  'anonymous callers cannot');
select has_column('public', 'whatsapp_message_templates', 'body', 'Meta''s template text is kept');
select has_column('public', 'whatsapp_message_templates', 'header_format', 'and its header format');

-- ------------------------------------------------------------------ the sync keeps Meta's text
select is(public.sync_whatsapp_message_templates((select nexus from tests.ids), 'waba-ns', $json$[
  {"id": "900000000001", "name": "monthly_statement", "language": "en_ZA", "category": "UTILITY", "status": "APPROVED",
   "body": "Good day {{1}}. Your {{2}} statement is attached.", "header_format": "DOCUMENT"},
  {"id": "900000000011", "name": "statement_plain", "language": "en_US", "category": "UTILITY", "status": "APPROVED",
   "body": "Good day {{1}}. Your statement is ready."},
  {"id": "900000000012", "name": "promo", "language": "en", "category": "MARKETING", "status": "APPROVED", "body": "Hello {{1}}."},
  {"id": "900000000013", "name": "in_review", "language": "en", "category": "UTILITY", "status": "PENDING", "body": "Hello {{1}}."},
  {"id": "900000000014", "name": "renewal_notice", "language": "en", "category": "UTILITY", "status": "APPROVED", "body": "Your lease renewal is due on {{1}}."},
  {"id": "900000000015", "name": "pay_here", "language": "en", "category": "UTILITY", "status": "APPROVED", "body": "Pay into account number 62012345678. Ref {{1}}."},
  {"id": "900000000016", "name": "no_text", "language": "en", "category": "UTILITY", "status": "APPROVED"},
  {"id": "900000000017", "name": "gaps", "language": "en", "category": "UTILITY", "status": "APPROVED", "body": "Hello {{1}} and {{3}}."},
  {"id": "900000000018", "name": "named", "language": "en", "category": "UTILITY", "status": "APPROVED", "body": "Hello {{tenant_name}}."},
  {"id": "900000000019", "name": "otp", "language": "en", "category": "AUTHENTICATION", "status": "APPROVED", "body": "Code {{1}}."},
  {"id": "900000000020", "name": "owner_summary", "language": "en", "category": "UTILITY", "status": "APPROVED", "body": "Good day {{1}}. Lease {{2}} expires on {{3}}."}
]$json$::jsonb), 11, 'the sync stores every template');
select is((select body from public.whatsapp_message_templates where id = tests.meta('monthly_statement')),
  'Good day {{1}}. Your {{2}} statement is attached.', 'with Meta''s text');
select is((select header_format from public.whatsapp_message_templates where id = tests.meta('monthly_statement')), 'DOCUMENT',
  'and its header format');
select is((select body from public.whatsapp_message_templates where id = tests.meta('no_text')), null, 'a template without text has none');

-- KP's own template, which Nexus can never choose.
insert into public.whatsapp_message_templates (company_id, business_account_id, meta_template_id, name, language, category, status, body)
values ('20000000-0000-4000-8000-000000000002', 'waba-kp', '900000000099', 'kp_statement', 'en', 'UTILITY', 'APPROVED', 'Hello {{1}}.');

-- ------------------------------------------------------------------ roles
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$select tests.choose('monthly_statement', 'monthly_statement')$$, '42501', null,
  'a property manager cannot choose templates');
select throws_ok(
  $$insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body)
    values ('20000000-0000-4000-8000-000000000001', 'x', 'monthly_statement', 'tenant', 'x', 'en', 'utility', 'Hello')$$,
  '42501', null, 'nor write a message template directly');
reset role;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$select tests.choose('monthly_statement', 'monthly_statement')$$, '42501', null, 'a read-only member cannot either');
reset role;

-- ------------------------------------------------------------------ a company admin chooses
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok(
  $$select public.set_message_type_template('20000000-0000-4000-8000-000000000001', 'monthly_statement',
      tests.meta('monthly_statement'), array['Tenant name', 'Statement period'])$$,
  'a company admin chooses an approved Utility template for the monthly statement');
reset role;
select is((tests.mapped('monthly_statement')).meta_template_name, 'monthly_statement', 'the type is mapped to it');
select is((tests.mapped('monthly_statement')).audience::text, 'tenant', 'for tenants');
select is((tests.mapped('monthly_statement')).language, 'en_ZA', 'in its language');
select is((tests.mapped('monthly_statement')).body, 'Good day {{1}}. Your {{2}} statement is attached.', 'with Meta''s text');
select is((tests.mapped('monthly_statement')).variables, array['Tenant name', 'Statement period'], 'and the variables named');
select is((tests.mapped('monthly_statement')).approval_status::text, 'approved', 'approved, as Meta reports');
select ok((tests.mapped('monthly_statement')).supports_document_attachment, 'a document header carries the statement PDF');
select is((tests.mapping('monthly_statement')).mapped_by_user_id, (select thandi from tests.ids), 'who chose it is stamped');
select is(
  (select summary from tests.audit((tests.mapped('monthly_statement')).id) order by occurred_at desc limit 1),
  'Monthly statement now sent with WhatsApp template monthly_statement (en_ZA)', 'choosing is audited on the template');
select is(
  (select actor_user_id from tests.audit((tests.mapped('monthly_statement')).id) order by occurred_at desc limit 1),
  (select thandi from tests.ids), 'by the admin');

-- Changing the mapping.
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok($$select tests.choose('monthly_statement', 'statement_plain')$$, 'the admin changes the mapping');
reset role;
select is((tests.mapped('monthly_statement')).meta_template_name, 'statement_plain', 'the type now uses the other template');
select ok(not (tests.mapped('monthly_statement')).supports_document_attachment, 'which carries no document');
select is((tests.mapped('monthly_statement')).variables, array['Variable 1'], 'unnamed variables are numbered');
select is(
  (select changes -> 1 from tests.audit((tests.mapped('monthly_statement')).id) order by occurred_at desc limit 1),
  jsonb_build_object('field', 'template', 'before', 'monthly_statement (en_ZA)', 'after', 'statement_plain (en_US)'),
  'the change is audited with the template before and after');

-- ------------------------------------------------------------------ refused
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$select tests.choose('initial_payment_reminder', 'in_review')$$, 'P0001',
  'Meta has not approved "in_review" (Pending). Only approved templates can be chosen.', 'a template Meta has not approved');
select throws_ok($$select tests.choose('initial_payment_reminder', 'promo')$$, 'P0001',
  'A tenant message needs a Utility template for statement and payment messages; "promo" is Marketing.', 'a marketing template for a tenant type');
select throws_ok($$select tests.choose('overdue_payment_reminder', 'renewal_notice')$$, 'P0001',
  'Tenant messages may not mention renewal option', 'a tenant template about a renewal');
select throws_ok($$select tests.choose('owner_weekly_summary', 'pay_here')$$, 'P0001',
  'Messages may not contain banking details (LeaseGuard never collects payments)', 'bank details for any audience');
select throws_ok($$select tests.choose('overdue_payment_reminder', 'no_text')$$, 'P0001', null, 'a template without text');
select throws_ok($$select tests.choose('overdue_payment_reminder', 'gaps')$$, 'P0001', null, 'placeholders with gaps');
select throws_ok($$select tests.choose('overdue_payment_reminder', 'named')$$, 'P0001', null, 'named placeholders');
select throws_ok($$select tests.choose('owner_query_response', 'otp')$$, 'P0001', null, 'an authentication template');
select throws_ok($$select tests.choose('manual', 'statement_plain')$$, '22023', null, 'a type sent without a template');
select throws_ok($$select tests.choose('initial_payment_reminder', 'statement_plain')$$, 'P0001',
  '"statement_plain" (en_US) already sends Monthly statement messages. A template sends one message type.',
  'a template already sending another type');
select throws_ok(
  $$select public.set_message_type_template('20000000-0000-4000-8000-000000000001', 'monthly_statement',
      (select id from public.whatsapp_message_templates where name = 'kp_statement'))$$,
  'P0002', null, 'another company''s template');
select lives_ok($$select tests.choose('owner_weekly_summary', 'owner_summary')$$,
  'an owner may be told about lease expiry, and a marketing-free utility template serves an owner type');
reset role;
select is((tests.mapped('owner_weekly_summary')).audience::text, 'property_owner', 'for property owners');

-- ------------------------------------------------------------------ the database guards every role
select throws_ok(
  $$insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body)
    values ('20000000-0000-4000-8000-000000000001', 'Deposit', 'monthly_statement', 'tenant', 'deposit_v1', 'en', 'utility', 'Your deposit of {{1}} is held.')$$,
  '23514', 'Tenant messages may not mention deposit', 'a tenant template about a forbidden topic is refused for every role');
select throws_ok(
  $$insert into public.message_templates (company_id, name, message_type, audience, meta_template_name, language, category, body)
    values ('20000000-0000-4000-8000-000000000001', 'Pay', 'owner_weekly_summary', 'property_owner', 'pay_v1', 'en', 'utility', 'Banking details: {{1}}')$$,
  '23514', null, 'banking details are refused for every audience');
select throws_ok(
  $$update public.message_templates set message_type = 'initial_payment_reminder'
    where id = (tests.mapped('monthly_statement')).id$$,
  'P0001', null, 'a mapped template''s message type is fixed');
select throws_ok(
  $$insert into public.message_type_templates (company_id, message_type, message_template_id)
    values ('20000000-0000-4000-8000-000000000001', 'overdue_payment_reminder', (tests.mapped('owner_weekly_summary')).id)$$,
  'P0001', null, 'a mapping''s type is its template''s');

-- ------------------------------------------------------------------ companies
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
set local role authenticated;
select is((select count(*) from public.message_type_templates)::int, 0, 'another company sees none of the mappings');
reset role;
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.message_type_templates)::int, 2, 'every member of the company reads them');
reset role;

select * from finish();
rollback;
