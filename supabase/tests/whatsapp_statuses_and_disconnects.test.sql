-- Meta-side disconnects and template status changes (20261110101000_whatsapp_statuses_and_disconnects): account
-- events carry no receiving number, only the WhatsApp Business Account, so they apply to the companies that hold
-- verified access to that account (a stored business token or a connected number). Removing LeaseGuard in Meta
-- disconnects that company's numbers, deletes its stored token and notifies its admins; another company that only
-- typed the same account id is untouched. Template status changes apply in order and are reflected onto the
-- company's own templates.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(52);

create schema tests;

\set ns '\'20000000-0000-4000-8000-000000000001\''
\set kp '\'20000000-0000-4000-8000-000000000002\''
\set thandi '\'10000000-0000-4000-8000-000000000001\''

-- KP typed NS's account id with a number of its own (env token, never verified): no verified access.
insert into public.whatsapp_phone_numbers (company_id, business_account_id, phone_number_id, display_name, display_number, connection_status)
values (:kp, 'waba-ns', 'phone-kp-typed', 'Typed', '+27 12 555 0299', 'pending_verification');

-- ================================================================== privileges
select ok(not has_function_privilege('authenticated', 'public.remove_whatsapp_business_account_access(text, text, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.remove_whatsapp_business_account_access(text, text, timestamptz)', 'execute'),
  'signed-in users and anon cannot disconnect an account on Meta''s behalf');
select ok(not has_function_privilege('authenticated', 'public.apply_whatsapp_template_status(text, text, text, text, text, text, text, timestamptz)', 'execute'),
  'signed-in users cannot change a template''s Meta status');
select ok(not has_function_privilege('authenticated', 'public.whatsapp_business_account_holders(text)', 'execute'),
  'signed-in users cannot look up which companies hold an account');
select ok(has_function_privilege('service_role', 'public.remove_whatsapp_business_account_access(text, text, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.apply_whatsapp_template_status(text, text, text, text, text, text, text, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.whatsapp_business_account_holders(text)', 'execute')
          and has_function_privilege('service_role', 'private.whatsapp_template_approval(text)', 'execute'),
  'the worker (service role) applies account events');
select is((select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.proname = 'remove_whatsapp_business_account_access' and p.prosecdef),
  'search_path=""', 'the removal is SECURITY DEFINER with an empty search_path');
select ok(has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'disconnected_reason', 'select')
          and has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'messaging_limit_tier', 'select'),
  'members read why a number was disconnected and its messaging limit');
select ok(not has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'disconnected_reason', 'update')
          and not has_column_privilege('authenticated', 'public.whatsapp_phone_numbers', 'messaging_limit_tier', 'update'),
  'but never write them');

-- ================================================================== who holds an account
select is((select array_agg(company_id) from public.whatsapp_business_account_holders('waba-ns')), array[:ns::uuid],
  'a connected number gives verified access; a company that only typed the account id does not');
select is((select count(*) from public.whatsapp_business_account_holders('waba-kp')), 0::bigint,
  'a pending number on the env token gives no verified access');
select is((select count(*) from public.whatsapp_business_account_holders('unknown-account')), 0::bigint, 'an unknown account has no holder');

-- ================================================================== template status changes
select is((select array_agg(row(company_id, outcome)::text) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000001', 'monthly_statement', 'en_ZA', null, 'PAUSED', 'Low quality', now() + interval '1 minute')),
  array[row(:ns::uuid, 'updated')::text], 'a status change applies to the holder only');
select is((select row(status, rejected_reason)::text from public.whatsapp_message_templates where company_id = :ns and meta_template_id = '900000000001'),
  row('PAUSED', 'Low quality')::text, 'the template shows Meta''s new status and reason');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000001', 'monthly_statement', 'en_ZA', null, 'APPROVED', null, now() - interval '1 hour')),
  array['stale'], 'an older status that arrives late never overwrites a newer one');
select is((select status from public.whatsapp_message_templates where company_id = :ns and meta_template_id = '900000000001'), 'PAUSED',
  'so the template stays paused');
select is((select status from public.whatsapp_message_templates where company_id = :kp and meta_template_id = '900000000002'), 'PENDING',
  'another company''s templates are untouched');

-- A new template matching the company's own template is added and reflected; then paused, then deleted.
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000077', 'monthly_statement_v1', 'en', 'utility', 'APPROVED', 'NONE', now() + interval '1 minute')),
  array['added'], 'a template LeaseGuard had not synced yet is added');
select is((select row(category, status, rejected_reason)::text from public.whatsapp_message_templates where company_id = :ns and meta_template_id = '900000000077'),
  row('UTILITY', 'APPROVED', null)::text, 'with its category; Meta''s NONE reason is no reason');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'), 'approved',
  'Meta''s approval is reflected onto the company''s own template');
select is((select approval_status::text from public.message_templates where company_id = :kp and meta_template_name = 'monthly_statement_v1'), 'draft',
  'but not onto another company''s template with the same name');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000077', null, null, null, 'FLAGGED', null, now() + interval '2 minutes')),
  array['updated'], 'a flagged template is recorded');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'), 'approved',
  'and stays approved: Meta still sends a flagged template');
-- The template sync maps Meta's statuses the same way, so the next sync of the account never flips it.
select is(public.sync_whatsapp_message_templates(:ns, 'waba-ns', jsonb_build_array(
            jsonb_build_object('id', '900000000001', 'name', 'monthly_statement', 'language', 'en_ZA', 'category', 'UTILITY', 'status', 'PAUSED'),
            jsonb_build_object('id', '900000000077', 'name', 'monthly_statement_v1', 'language', 'en', 'category', 'UTILITY', 'status', 'FLAGGED'))),
  2, 'the account is synced with the template still flagged');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'), 'approved',
  'and the sync keeps it approved, like the webhook');
select is((select array_agg(distinct private.whatsapp_template_approval(s)::text order by private.whatsapp_template_approval(s)::text)
           from unnest(array['APPROVED', 'FLAGGED']) s), array['approved'], 'the one mapping: approved and flagged are sendable');
-- An event that names no status (UNARCHIVED) is never stored as one: anything unknown would map to rejected.
select throws_ok($$select * from public.apply_whatsapp_template_status('waba-ns', '900000000077', null, null, null, 'UNARCHIVED', null, now() + interval '150 seconds')$$,
  '22023', null, 'an event that is not a Meta template status is refused');
select is((select row(w.status, m.approval_status)::text from public.whatsapp_message_templates w
           join public.message_templates m on m.company_id = w.company_id and m.meta_template_name = w.name and m.language = w.language
           where w.company_id = :ns and w.meta_template_id = '900000000077'),
  row('FLAGGED', 'approved')::text, 'so the sendable template is left as it was');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000077', null, null, null, 'DISABLED', null, now() + interval '3 minutes')),
  array['updated'], 'a disabled template is recorded');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'), 'rejected',
  'and the outbound gate stops treating it as approved');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000077', null, null, null, 'APPROVED', null, now() + interval '210 seconds')),
  array['updated'], 'a reinstated template is approved again');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000077', null, null, null, 'DELETED', null, now() + interval '4 minutes')),
  array['removed'], 'a deleted template is removed');
select is((select approval_status::text from public.message_templates where company_id = :ns and meta_template_name = 'monthly_statement_v1'), 'draft',
  'and the company''s template goes back to draft');
select is((select array_agg(outcome) from public.apply_whatsapp_template_status(
            'waba-ns', '900000000078', null, null, null, 'APPROVED', null, now())),
  array['unknown_template'], 'a status for a template without a name LeaseGuard cannot place is reported, not invented');
select is((select count(*) from public.apply_whatsapp_template_status('unknown-account', '900000000099', 'x', 'en', null, 'APPROVED', null)), 0::bigint,
  'the event time may be left out (Meta can omit entry.time)');
select throws_ok($$select * from public.apply_whatsapp_template_status('waba-ns', 'not-a-meta-id', 'x', 'en', null, 'APPROVED', null, now())$$,
  '22023', null, 'a template id that is not Meta''s is refused');

-- ================================================================== Meta-side removal
select is((select array_agg(row(company_id, numbers_disconnected, token_removed, admins_notified)::text)
           from public.remove_whatsapp_business_account_access('waba-ns', 'PARTNER_APP_UNINSTALLED', now())),
  array[row(:ns::uuid, 1, false, 1)::text], 'the uninstall disconnects the holder''s number and notifies its one admin');
select is((select row(connection_status, webhook_configured, last_verified_at is null, disconnected_at is not null)::text
           from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = 'phone-ns'),
  row('disconnected', false, true, true)::text, 'the number is disconnected, with no webhook and no verification');
select alike((select disconnected_reason from public.whatsapp_phone_numbers where company_id = :ns and phone_number_id = 'phone-ns'),
  '%removed LeaseGuard%in Meta%', 'and says it was removed in Meta');
select is((select count(*) from public.whatsapp_number_verification_steps s join public.whatsapp_phone_numbers n on n.id = s.number_id
           where n.company_id = :ns and n.phone_number_id = 'phone-ns'), 0::bigint, 'its verification results are dropped');
select is((select row(connection_status, disconnected_reason)::text from public.whatsapp_phone_numbers where company_id = :kp and phone_number_id = 'phone-kp-typed'),
  row('pending_verification', null)::text, 'the company that only typed the account id is untouched');
select is((select row(user_id, type, severity)::text from public.notifications where company_id = :ns and dedupe_key like 'whatsapp-access-removed:%'),
  row(:thandi::uuid, 'system', 'critical')::text, 'the company admin is notified (not managers, owners or read-only members)');
select is((select count(*) from public.notifications where company_id = :kp and dedupe_key like 'whatsapp-access-removed:%'), 0::bigint,
  'no other company is notified');
select ok((select body not like '%deleted%' from public.notifications where company_id = :ns and dedupe_key like 'whatsapp-access-removed:%'),
  'the notification claims no token deletion when none was deleted (the number used the worker''s env token)');
select is((select count(*) from public.remove_whatsapp_business_account_access('waba-ns', 'PARTNER_APP_UNINSTALLED', now())), 0::bigint,
  'a retried event finds nothing in use any more');
select is((select count(*) from public.notifications where company_id = :ns and dedupe_key like 'whatsapp-access-removed:%'), 1::bigint,
  'and notifies nobody twice');

-- A stored business token: deleted, unless it was granted after the event (a reconnect overtook a late event).
insert into public.company_users (company_id, user_id, role) values (:kp, :thandi, 'company_admin');
create table tests.secret as
  select vault.create_secret('EAAG-kp-token-0123456789', 'whatsapp_access_token:20000000-0000-4000-8000-000000000002:onboarding:t1') as id;
update public.whatsapp_business_accounts set access_token_reference = 'secret://vault/' || (select id from tests.secret)
where company_id = :kp and business_account_id = 'waba-kp';
update public.whatsapp_phone_numbers set access_token_reference = 'secret://vault/' || (select id from tests.secret)
where company_id = :kp and phone_number_id = 'phone-kp';
select is((select array_agg(row(company_id, numbers_disconnected, token_removed, admins_notified)::text)
           from public.remove_whatsapp_business_account_access('waba-kp', 'PARTNER_APP_UNINSTALLED', now() - interval '1 hour')),
  array[row(:kp::uuid, 0, false, 0)::text], 'an event older than the stored token leaves the newer connection alone');
select is((select array_agg(row(company_id, numbers_disconnected, token_removed, admins_notified)::text)
           from public.remove_whatsapp_business_account_access('waba-kp', 'PARTNER_REMOVED', now())),
  array[row(:kp::uuid, 1, true, 1)::text], 'a current removal disconnects the number and deletes the stored token');
select is((select count(*) from vault.secrets where id = (select id from tests.secret)), 0::bigint, 'the vault secret is gone');
select alike((select body from public.notifications where company_id = :kp and dedupe_key like 'whatsapp-access-removed:%'),
  '%deleted its stored access token.%', 'and the admin is told the stored token was deleted');
select is((select access_token_reference from public.whatsapp_business_accounts where company_id = :kp and business_account_id = 'waba-kp'), null,
  'and the account no longer references it');
select throws_ok($$select * from public.remove_whatsapp_business_account_access('waba-kp', 'ACCOUNT_RESTRICTION', now())$$,
  '22023', null, 'only events that end LeaseGuard''s access disconnect');

select is((select count(*) from public.remove_whatsapp_business_account_access('unknown-account', 'ACCOUNT_DELETED')), 0::bigint,
  'the event time may be left out of a removal (Meta can omit entry.time)');

-- Reconnecting clears the reason.
update public.whatsapp_phone_numbers set connection_status = 'pending_verification' where company_id = :kp and phone_number_id = 'phone-kp';
select is((select row(disconnected_at, disconnected_reason)::text from public.whatsapp_phone_numbers where company_id = :kp and phone_number_id = 'phone-kp'),
  row(null, null)::text, 'a number that is connected again no longer shows why it was disconnected');

select * from finish();
rollback;
