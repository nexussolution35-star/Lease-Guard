-- AI agent configuration and knowledge base (20261111100000_whatsapp_agent_and_knowledge): one configuration per
-- company, written by its company admins only; FAQs, knowledge entries and documents are drafts until a company admin
-- approves them, and changing approved content makes it a draft again; members read their own company's rows only;
-- the agent runtime (service role) reads one company's configuration and APPROVED knowledge only.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(63);

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.uid(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where email = p_email
$$;
create function tests.faq(p_question text) returns public.whatsapp_knowledge_faqs
language sql security definer set search_path = '' as $$
  select * from public.whatsapp_knowledge_faqs where question = p_question
$$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''

-- ================================================================== shape and privileges
select has_table('public', 'whatsapp_agent_configs', 'agent configurations have a table');
select has_table('public', 'whatsapp_agent_handover_contacts', 'handover contacts have a table');
select has_table('public', 'whatsapp_knowledge_faqs', 'FAQs have a table');
select has_table('public', 'whatsapp_knowledge_entries', 'knowledge entries have a table');
select has_table('public', 'whatsapp_knowledge_documents', 'knowledge documents have a table');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like any (array['whatsapp_agent_%', 'whatsapp_knowledge_%']) and c.relkind = 'r' and c.relrowsecurity),
  5::bigint, 'row level security is enabled on all five tables');
select col_is_pk('public', 'whatsapp_agent_configs', 'company_id', 'one configuration per company');
select ok(not has_table_privilege('anon', 'public.whatsapp_knowledge_faqs', 'select')
          and not has_table_privilege('anon', 'public.whatsapp_agent_configs', 'select'), 'anon reads nothing');
select ok(not has_column_privilege('authenticated', 'public.whatsapp_knowledge_faqs', 'status', 'insert')
          and not has_column_privilege('authenticated', 'public.whatsapp_knowledge_faqs', 'approved_by_user_id', 'update')
          and not has_column_privilege('authenticated', 'public.whatsapp_knowledge_documents', 'storage_path', 'update'),
  'signed-in users never write approval stamps, nor insert approved items, nor move a document');
select ok(not has_function_privilege('authenticated', 'public.whatsapp_agent_knowledge(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.whatsapp_agent_knowledge(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.whatsapp_agent_knowledge(uuid)', 'execute'),
  'only the agent runtime (service role) reads the agent''s knowledge function');
select ok(has_function_privilege('authenticated', 'public.save_whatsapp_agent_config(uuid, jsonb, uuid[])', 'execute')
          and not has_function_privilege('anon', 'public.save_whatsapp_agent_config(uuid, jsonb, uuid[])', 'execute')
          and not has_function_privilege('service_role', 'public.save_whatsapp_agent_config(uuid, jsonb, uuid[])', 'execute'),
  'signed-in users call save_whatsapp_agent_config (it checks the role)');
select is((select prosecdef from pg_proc where oid = 'public.save_whatsapp_agent_config(uuid, jsonb, uuid[])'::regprocedure), false,
  'saving runs as the caller, so RLS applies');

-- ================================================================== reading: members of the company only
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select is((select count(*) from public.whatsapp_knowledge_faqs where company_id = :ns), 2::bigint, 'a read-only member reads the company''s FAQs, drafts included');
select is((select agent_name from public.whatsapp_agent_configs), 'Nexus assistant', 'and its agent configuration only');
select is((select count(*) from public.whatsapp_knowledge_faqs where company_id = :kp)
          + (select count(*) from public.whatsapp_knowledge_entries where company_id = :kp)
          + (select count(*) from public.whatsapp_knowledge_documents where company_id = :kp)
          + (select count(*) from public.whatsapp_agent_handover_contacts where company_id = :kp), 0::bigint,
  'and nothing of another company');
select throws_ok($$insert into public.whatsapp_knowledge_faqs (company_id, question, answer) values ('20000000-0000-4000-8000-000000000001', 'Q', 'A')$$,
  '42501', null, 'a read-only member cannot add an FAQ');
reset role;

-- ================================================================== writing: company admins only
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$insert into public.whatsapp_knowledge_entries (company_id, title, content) values ('20000000-0000-4000-8000-000000000001', 'T', 'C')$$,
  '42501', null, 'a property manager cannot add knowledge');
update public.whatsapp_knowledge_faqs set status = 'approved' where question = 'NS draft question';
delete from public.whatsapp_knowledge_entries where company_id = :ns;
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X"}', '{}')$$,
  '42501', null, 'a property manager cannot configure the agent');
reset role;
select is((tests.faq('NS draft question')).status, 'draft', 'a property manager''s approval changed nothing');
select is((select count(*) from public.whatsapp_knowledge_entries where company_id = :ns), 2::bigint, 'nor did their delete');

select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok($$insert into public.whatsapp_knowledge_faqs (company_id, question, answer, status) values ('20000000-0000-4000-8000-000000000001', 'Q', 'A', 'approved')$$,
  '42501', null, 'nobody inserts an item already approved');
select throws_ok($$insert into public.whatsapp_knowledge_faqs (company_id, question, answer) values ('20000000-0000-4000-8000-000000000002', 'Q', 'A')$$,
  '42501', null, 'a company admin cannot write another company''s knowledge');
insert into public.whatsapp_knowledge_faqs (company_id, question, answer) values (:ns, 'Is there a loading bay?', 'Yes, at the back of block B.');
select is((select row(status, approved_at, created_by_user_id)::text from tests.faq('Is there a loading bay?')),
  row('draft', null::timestamptz, tests.uid('thandi.mokoena@nexussolution.co.za'))::text, 'a new FAQ is a draft by its author');
update public.whatsapp_knowledge_faqs set status = 'approved' where question = 'Is there a loading bay?';
select is((select row(status, approved_at is not null, approved_by_user_id)::text from tests.faq('Is there a loading bay?')),
  row('approved', true, tests.uid('thandi.mokoena@nexussolution.co.za'))::text, 'approving stamps the approver and time');
select throws_ok($$update public.whatsapp_knowledge_faqs set approved_by_user_id = null where question = 'Is there a loading bay?'$$,
  '42501', null, 'the approval stamp is not writable');
update public.whatsapp_knowledge_faqs set answer = 'Yes, at the back of block C.' where question = 'Is there a loading bay?';
select is((select row(status, approved_at, approved_by_user_id)::text from tests.faq('Is there a loading bay?')),
  row('draft', null::timestamptz, null::uuid)::text, 'changing approved content makes it a draft again');
update public.whatsapp_knowledge_faqs set answer = 'Yes, at the back of block D.', status = 'approved' where question = 'Is there a loading bay?';
select is((tests.faq('Is there a loading bay?')).status, 'draft', 'content cannot change and be approved in one step');
update public.whatsapp_knowledge_faqs set status = 'approved' where question = 'Is there a loading bay?';
update public.whatsapp_knowledge_faqs set status = 'draft' where question = 'Is there a loading bay?';
select is((select row(status, approved_at)::text from tests.faq('Is there a loading bay?')), row('draft', null::timestamptz)::text,
  'an admin can withdraw an approval');
delete from public.whatsapp_knowledge_faqs where question = 'Is there a loading bay?';
select is((select count(*) from public.whatsapp_knowledge_faqs where question = 'Is there a loading bay?'), 0::bigint, 'an admin deletes an FAQ');

-- Entries and documents follow the same rules.
insert into public.whatsapp_knowledge_entries (company_id, title, content) values (:ns, 'Refuse removal', 'Tuesdays.');
update public.whatsapp_knowledge_entries set status = 'approved' where title = 'Refuse removal';
select is((select status from public.whatsapp_knowledge_entries where title = 'Refuse removal'), 'approved', 'an admin approves an entry');
update public.whatsapp_knowledge_entries set content = 'Thursdays.' where title = 'Refuse removal';
select is((select status from public.whatsapp_knowledge_entries where title = 'Refuse removal'), 'draft', 'and an edit returns it to draft');
select lives_ok(
  $$insert into public.whatsapp_knowledge_documents (id, company_id, title, file_name, storage_path, mime_type, size_bytes)
    values ('97000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Rules', 'rules.pdf',
            '20000000-0000-4000-8000-000000000001/97000000-0000-4000-8000-0000000000a1/rules.pdf', 'application/pdf', 2048)$$,
  'an admin registers a document under the company''s prefix');
select throws_ok(
  $$insert into public.whatsapp_knowledge_documents (id, company_id, title, file_name, storage_path, mime_type, size_bytes)
    values ('97000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001', 'X', 'x.pdf',
            '20000000-0000-4000-8000-000000000002/97000000-0000-4000-8000-0000000000a2/x.pdf', 'application/pdf', 2048)$$,
  '23514', null, 'a document cannot point at another company''s files');
select throws_ok(
  $$insert into public.whatsapp_knowledge_documents (id, company_id, title, file_name, storage_path, mime_type, size_bytes)
    values ('97000000-0000-4000-8000-0000000000a3', '20000000-0000-4000-8000-000000000001', 'X', 'x.pdf',
            '20000000-0000-4000-8000-000000000001/97000000-0000-4000-8000-0000000000a1/x.pdf', 'application/pdf', 2048)$$,
  '23514', null, 'nor at another document''s folder');
select throws_ok(
  $$insert into public.whatsapp_knowledge_documents (id, company_id, title, file_name, storage_path, mime_type, size_bytes)
    values ('97000000-0000-4000-8000-0000000000a4', '20000000-0000-4000-8000-000000000001', 'X', 'x.exe',
            '20000000-0000-4000-8000-000000000001/97000000-0000-4000-8000-0000000000a4/x.exe', 'application/x-msdownload', 2048)$$,
  '23514', null, 'documents are PDF, PNG, JPEG or plain text');

-- ================================================================== the configuration
select is(
  (select row(agent_name, auto_reply_enabled, timezone, updated_by_user_id)::text
   from public.save_whatsapp_agent_config(:ns,
     '{"agent_name":"Nexus helper","tone":"Warm and brief","operating_hours":[{"day":"friday","opens":"08:00","closes":"16:00"}],"languages":["en","zu"],"permitted_actions":["answer_faq"],"auto_reply_enabled":false,"out_of_hours_message":"We are closed."}',
     array[tests.uid('naledi.vdmerwe@nexussolution.co.za'), tests.uid('thandi.mokoena@nexussolution.co.za')])),
  row('Nexus helper', false, 'Africa/Johannesburg', tests.uid('thandi.mokoena@nexussolution.co.za'))::text,
  'a company admin saves the configuration (timezone defaults to Johannesburg)');
select is((select array_agg(user_id order by user_id) from public.whatsapp_agent_handover_contacts where company_id = :ns),
  array[tests.uid('thandi.mokoena@nexussolution.co.za'), tests.uid('naledi.vdmerwe@nexussolution.co.za')]::uuid[] ,
  'and replaces the handover contacts');
select is((select count(*) from public.whatsapp_agent_configs where company_id = :ns), 1::bigint, 'still one configuration per company');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X"}', array[tests.uid('kabelo.molefe@nexussolution.co.za')])$$,
  '22023', null, 'a read-only member cannot be a handover contact');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X"}', array[tests.uid('lerato@kgalagadiproperty.co.za')])$$,
  '22023', null, 'nor a member of another company');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000002', '{"agent_name":"X"}', '{}')$$,
  '42501', null, 'a company admin cannot configure another company''s agent');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X","permitted_actions":["send_tenant_message"]}', '{}')$$,
  '23514', null, 'only the known actions are permitted');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X","operating_hours":[{"day":"monday","opens":"17:00","closes":"08:00"}]}', '{}')$$,
  '23514', null, 'operating hours close after they open');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":"X","languages":["fr"]}', '{}')$$,
  '23514', null, 'languages are South African languages');
select throws_ok($$select public.save_whatsapp_agent_config('20000000-0000-4000-8000-000000000001', '{"agent_name":" "}', '{}')$$,
  '23514', null, 'the agent has a name');
select throws_ok($$update public.whatsapp_agent_configs set company_id = '20000000-0000-4000-8000-000000000002' where company_id = '20000000-0000-4000-8000-000000000001'$$,
  null, null, 'a configuration never moves to another company');
reset role;
select is((select count(*) from public.audit_logs where company_id = :ns and summary in ('Updated the AI agent settings', 'Approved the FAQ "Is there a loading bay?" for the AI agent')),
  3::bigint, 'saving the configuration and approving knowledge are audited');

-- A handover contact who is no longer a writer is not told (below); one who leaves the company is removed (FK cascade).
update public.company_users set role = 'read_only' where company_id = :ns and user_id = tests.uid('naledi.vdmerwe@nexussolution.co.za');
select fk_ok('public', 'whatsapp_agent_handover_contacts', array['company_id', 'user_id'], 'public', 'company_users', array['company_id', 'user_id'],
  'handover contacts are members of the same company');

-- ================================================================== what the agent runtime reads
set local role service_role;
select is((select jsonb_array_length(public.whatsapp_agent_knowledge(:ns) -> 'faqs')), 1, 'the agent gets the approved FAQ only');
select is((select public.whatsapp_agent_knowledge(:ns) -> 'faqs' -> 0 ->> 'question'), 'Where do visitors park?', 'the approved one');
select is((select jsonb_array_length(public.whatsapp_agent_knowledge(:ns) -> 'entries')), 1, 'the approved entry only');
select is((select jsonb_array_length(public.whatsapp_agent_knowledge(:ns) -> 'documents')), 1, 'the approved document only');
select is((select public.whatsapp_agent_knowledge(:ns) -> 'config' ->> 'agentName'), 'Nexus helper', 'and the company''s configuration');
select is((select public.whatsapp_agent_knowledge(:ns) -> 'handoverContactUserIds'),
  jsonb_build_array(tests.uid('thandi.mokoena@nexussolution.co.za')), 'with its active handover contacts');
select ok((select public.whatsapp_agent_knowledge(:ns)::text not like '%draft%'), 'no draft text reaches the agent');
select ok((select public.whatsapp_agent_knowledge(:ns)::text not like '%KP %' and public.whatsapp_agent_knowledge(:ns)::text not like '%Kgalagadi%'),
  'nothing of another company reaches the agent');
select is((select public.whatsapp_agent_knowledge(:kp) -> 'faqs' -> 0 ->> 'answer'), 'KP access cards: reception, ground floor.',
  'the other company''s agent gets its own approved knowledge');
select is((select public.whatsapp_agent_knowledge('20000000-0000-4000-8000-0000000000ff') -> 'config'), 'null'::jsonb,
  'a company without a configuration has none');
reset role;

-- ================================================================== storage: agent-knowledge bucket
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'agent-knowledge'), row(false, 10485760::bigint)::text,
  'the agent-knowledge bucket is private and limited to 10 MB');
select set_config('request.jwt.claims', tests.claims('thandi.mokoena@nexussolution.co.za'), true);
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('agent-knowledge', '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/rules.pdf')$$,
  'a company admin uploads under the company''s prefix');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('agent-knowledge', '20000000-0000-4000-8000-000000000002/' || gen_random_uuid() || '/x.pdf')$$,
  '42501', null, 'but not under another company''s');
select set_config('request.jwt.claims', tests.claims('sipho.dlamini@nexussolution.co.za'), true);
select throws_ok($$insert into storage.objects (bucket_id, name) values ('agent-knowledge', '20000000-0000-4000-8000-000000000001/' || gen_random_uuid() || '/x.pdf')$$,
  '42501', null, 'a property manager cannot upload knowledge documents');
select is((select count(*) from storage.objects where bucket_id = 'agent-knowledge'), 1::bigint, 'members read their company''s knowledge files');
reset role;

select * from finish();
rollback;
